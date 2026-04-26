import { eq, and, gt, gte, lte, desc, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  users,
  subscriptions,
  seenTweets,
  dailyStats,
  filterRules,
  mutedAccounts,
  aiUsageLog,
  deviceSessions,
  passwordResetTokens,
  type Subscription,
  type SeenTweet,
  type DailyStat,
  type FilterRule,
  type MutedAccount,
  type AiUsageLog,
  type DeviceSession,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// upsertUser and getUserByOpenId removed in v2.0
// Reason: replaced Manus OAuth with email/password auth.
// New equivalent: createUserWithPassword + getUserByEmail (defined below).

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ========== Email/Password Auth (v2.0+) ==========

/**
 * Look up a user by their email address. Email is the primary identifier
 * for password-based login. Returns undefined if not found.
 */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  const normalized = email.trim().toLowerCase();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a brand-new user with email + password hash. The caller must hash
 * the password (with bcrypt) before passing it here — db.ts does not import
 * bcrypt to avoid circular deps and keep this module pure.
 *
 * Returns the new user row (including auto-generated id).
 * Throws if email is already taken — caller should catch and surface a
 * friendly "email already in use" error.
 */
export async function createUserWithPassword(
  email: string,
  passwordHash: string,
  name?: string | null,
): Promise<{ id: number; email: string; isPro: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalized = email.trim().toLowerCase();
  await db.insert(users).values({
    email: normalized,
    passwordHash,
    name: name ?? null,
    loginMethod: "email",
    role: "user",
    emailVerified: true, // Skipping email verification in v2.0
    isPro: false,
  });

  // Re-fetch by email — works regardless of how Drizzle returns insert metadata.
  const created = await getUserByEmail(normalized);
  if (!created) {
    throw new Error("Failed to fetch newly-created user");
  }
  return { id: created.id, email: created.email, isPro: created.isPro };
}

/**
 * Update an existing user's password hash. Used for password reset
 * and "change password" flows.
 */
export async function updatePasswordHash(
  userId: number,
  passwordHash: string,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, userId));
}

/**
 * Update lastSignedIn timestamp on successful login.
 * Best-effort — failure here should not block login.
 */
export async function touchLastSignedIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, userId));
  } catch (err) {
    console.warn("[Database] Failed to update lastSignedIn:", err);
  }
}

// ========== Subscription & Pro Plan ==========
export async function getOrCreateSubscription(userId: number): Promise<Subscription> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Create default free subscription
  await db.insert(subscriptions).values({
    userId,
    plan: "free",
    isPro: false,
    monthlyLimit: 500,
    aiMonthlyLimit: 10,
  });

  const created = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return created[0];
}

export async function updateProStatus(userId: number, isPro: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(subscriptions).set({ isPro }).where(eq(subscriptions.userId, userId));
  await db.update(users).set({ isPro }).where(eq(users.id, userId));
}

// ========== Seen Tweets (Senkronizasyon) ==========
export async function addSeenTweet(
  userId: number,
  tweetFingerprint: string,
  tweetId?: string,
  hiddenReason?: string
): Promise<SeenTweet> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(seenTweets).values({
    userId,
    tweetFingerprint,
    tweetId,
    hiddenReason,
    seenAt: new Date(),
  });

  const inserted = await db
    .select()
    .from(seenTweets)
    .where(eq(seenTweets.tweetFingerprint, tweetFingerprint))
    .limit(1);

  return inserted[0];
}

export async function getSeenTweets(
  userId: number,
  includeExpiredSnooze: boolean = false
): Promise<SeenTweet[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!includeExpiredSnooze) {
    // Only return tweets that are not yet shown after snooze
    return db
      .select()
      .from(seenTweets)
      .where(
        and(
          eq(seenTweets.userId, userId),
          eq(seenTweets.snoozeShown, false)
        )
      );
  } else {
    return db
      .select()
      .from(seenTweets)
      .where(eq(seenTweets.userId, userId));
  }
}

export async function setSnoozeTweet(
  userId: number,
  tweetFingerprint: string,
  snoozeHours: number = 24
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const snoozeUntil = new Date(Date.now() + snoozeHours * 60 * 60 * 1000);
  await db
    .update(seenTweets)
    .set({ snoozeUntil })
    .where(
      and(
        eq(seenTweets.userId, userId),
        eq(seenTweets.tweetFingerprint, tweetFingerprint)
      )
    );
}

export async function cleanExpiredSnooze(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  await db
    .update(seenTweets)
    .set({ snoozeShown: true })
    .where(
      and(
        eq(seenTweets.userId, userId),
        lte(seenTweets.snoozeUntil, now),
        eq(seenTweets.snoozeShown, false)
      )
    );

  // Return count of affected rows (approximate)
  const count = await db
    .select()
    .from(seenTweets)
    .where(
      and(
        eq(seenTweets.userId, userId),
        eq(seenTweets.snoozeShown, true)
      )
    );

  return count.length;
}

// ========== Daily Stats ==========
export async function getOrCreateDailyStat(userId: number, date: string): Promise<DailyStat> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)))
    .limit(1);

  if (existing.length > 0) return existing[0];

  await db.insert(dailyStats).values({
    userId,
    date,
    hiddenCount: 0,
    seenCount: 0,
    estimatedTimeSaved: 0,
  });

  const created = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)))
    .limit(1);

  return created[0];
}

export async function recordHiddenTweet(
  userId: number,
  date: string,
  estimatedTimeSaved: number = 5
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const stat = await getOrCreateDailyStat(userId, date);
  await db
    .update(dailyStats)
    .set({
      hiddenCount: (stat.hiddenCount || 0) + 1,
      estimatedTimeSaved: (stat.estimatedTimeSaved || 0) + estimatedTimeSaved,
    })
    .where(eq(dailyStats.id, stat.id));
}

export async function getStatsRange(
  userId: number,
  startDate: string,
  endDate: string
): Promise<DailyStat[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.date, startDate),
        lte(dailyStats.date, endDate)
      )
    )
    .orderBy(asc(dailyStats.date));
}

// ========== Filter Rules ==========
export async function getUserFilterRules(userId: number): Promise<FilterRule[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(filterRules)
    .where(and(eq(filterRules.userId, userId), eq(filterRules.isActive, true)))
    .orderBy(desc(filterRules.priority));
}

export async function addFilterRule(
  userId: number,
  ruleType: string,
  ruleValue: string,
  priority: number = 0
): Promise<FilterRule> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(filterRules).values({
    userId,
    ruleType: ruleType as any,
    ruleValue,
    priority,
    isActive: true,
  });

  const created = await db
    .select()
    .from(filterRules)
    .where(eq(filterRules.userId, userId))
    .orderBy(desc(filterRules.id))
    .limit(1);

  return created[0];
}

// ========== Muted Accounts ==========
export async function getMutedAccounts(userId: number): Promise<MutedAccount[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(mutedAccounts).where(eq(mutedAccounts.userId, userId));
}

export async function muteAccount(
  userId: number,
  accountHandle: string,
  muteHours?: number,
  reason?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const muteUntil = muteHours ? new Date(Date.now() + muteHours * 60 * 60 * 1000) : null;

  await db.insert(mutedAccounts).values({
    userId,
    accountHandle,
    muteUntil,
    reason,
  });
}

export async function cleanExpiredMutes(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  
  // Get expired mutes first
  const expired = await db
    .select()
    .from(mutedAccounts)
    .where(
      and(
        eq(mutedAccounts.userId, userId),
        lte(mutedAccounts.muteUntil, now)
      )
    );

  if (expired.length === 0) return 0;

  // Delete them
  await db
    .delete(mutedAccounts)
    .where(
      and(
        eq(mutedAccounts.userId, userId),
        lte(mutedAccounts.muteUntil, now)
      )
    );

  return expired.length;
}

// ========== AI Usage Tracking ==========
export async function logAiUsage(
  userId: number,
  operationType: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCost: number,
  responseTime: number,
  status: string = "success"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(aiUsageLog).values({
    userId,
    operationType: operationType as any,
    inputTokens,
    outputTokens,
    estimatedCost: estimatedCost.toString(),
    responseTime,
    status: status as any,
  });

  // Update subscription AI usage count
  const sub = await getOrCreateSubscription(userId);
  await db
    .update(subscriptions)
    .set({ aiUsageCount: (sub.aiUsageCount || 0) + 1 })
    .where(eq(subscriptions.userId, userId));
}

export async function getAiUsageThisMonth(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await db
    .select()
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.userId, userId),
        gte(aiUsageLog.createdAt, monthStart)
      )
    );

  return result.length;
}

/**
 * Count of AI summaries the user has consumed since 00:00 UTC today.
 * Used to enforce free-tier daily limits (e.g. 5 summaries/day).
 */
export async function getAiUsageToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const result = await db
    .select()
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.userId, userId),
        gte(aiUsageLog.createdAt, dayStart),
      ),
    );

  return result.length;
}

// ========== Device Sessions ==========
export async function registerDevice(
  userId: number,
  deviceId: string,
  browserType: string,
  deviceName?: string
): Promise<DeviceSession> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(deviceSessions)
    .where(
      and(
        eq(deviceSessions.userId, userId),
        eq(deviceSessions.deviceId, deviceId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(deviceSessions)
      .set({ lastSyncedAt: new Date(), isActive: true })
      .where(eq(deviceSessions.id, existing[0].id));
    return existing[0];
  }

  await db.insert(deviceSessions).values({
    userId,
    deviceId,
    browserType: browserType as any,
    deviceName,
    lastSyncedAt: new Date(),
    isActive: true,
  });

  const created = await db
    .select()
    .from(deviceSessions)
    .where(
      and(
        eq(deviceSessions.userId, userId),
        eq(deviceSessions.deviceId, deviceId)
      )
    )
    .limit(1);

  return created[0];
}

export async function getUserDevices(userId: number): Promise<DeviceSession[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.userId, userId))
    .orderBy(desc(deviceSessions.lastSyncedAt));
}

// ========== Password Reset Tokens (v2.1+) ==========

/**
 * Create a new password-reset token for a user.
 * Token is the caller's responsibility (random 32-byte hex), so this fn
 * doesn't assume any encoding — just stores what's given.
 *
 * Tokens expire in 1 hour by default (caller can override).
 * Single-use: marked with `usedAt` after redemption.
 */
export async function createPasswordResetToken(
  userId: number,
  token: string,
  expiresInMs: number = 60 * 60 * 1000,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(passwordResetTokens).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
}

/**
 * Look up a token. Returns the row if it exists, is unexpired, AND unused.
 * Returns null otherwise — caller treats this as "invalid token".
 */
export async function getValidPasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/**
 * Mark a token as redeemed. Call AFTER the password has been updated.
 * Best-effort; failure here is logged but not propagated.
 */
export async function markPasswordResetTokenUsed(token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
  } catch (err) {
    console.warn("[Database] Failed to mark password reset token used:", err);
  }
}

/**
 * Delete every reset token for a user — useful after a successful reset
 * to invalidate any other outstanding links.
 */
export async function deleteAllPasswordResetTokensForUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
  } catch (err) {
    console.warn("[Database] Failed to delete reset tokens:", err);
  }
}
