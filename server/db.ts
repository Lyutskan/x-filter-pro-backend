import { eq, and, gt, gte, lte, lt, desc, asc, or, isNull, isNotNull, ne } from "drizzle-orm";
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
  emailVerificationTokens,
  authSessions,
  type Subscription,
  type SeenTweet,
  type DailyStat,
  type FilterRule,
  type MutedAccount,
  type AiUsageLog,
  type DeviceSession,
  type AuthSession,
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
  emailVerified: boolean = false,
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
    emailVerified,
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

// ========== Email Verification (v2.1+) ==========

export async function createEmailVerificationToken(
  userId: number,
  token: string,
  expiresInMs: number = 24 * 60 * 60 * 1000, // 24h
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(emailVerificationTokens).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
}

export async function getValidEmailVerificationToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function markEmailVerificationTokenUsed(token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationTokens.token, token));
  } catch (err) {
    console.warn("[Database] Failed to mark email verification token used:", err);
  }
}

export async function deleteEmailVerificationTokensForUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId));
  } catch (err) {
    console.warn("[Database] Failed to delete email verification tokens:", err);
  }
}

/**
 * Mark a user's email as verified. Called by auth.verifyEmail after the
 * one-time token has been validated.
 */
export async function setEmailVerified(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, userId));
}

// ========== Auth Sessions (v2.1+) ==========

//
// Stateful session tracking. Every login creates a row here; logout/password-
// reset/manual-revoke marks `revokedAt`. The auth context checks the session
// on every authenticated request.

/**
 * Create a new session row at login time.
 * `sid` is caller-generated (random 32-byte hex), embedded in the JWT.
 */
export async function createAuthSession(
  sid: string,
  userId: number,
  deviceInfo: string | null,
  ipAddress: string | null,
  userAgent: string | null = null,
  expiresInMs: number = 30 * 24 * 60 * 60 * 1000, // 30 days, must match JWT TTL
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(authSessions).values({
    userId,
    sid,
    deviceLabel: deviceInfo,
    ip: ipAddress,
    userAgent,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
}

/**
 * Look up an active (non-revoked, non-expired) session by `sid`.
 * Returns null if not found, revoked, or expired.
 */
export async function getActiveAuthSession(sid: string): Promise<AuthSession | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.sid, sid))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/**
 * Update lastActiveAt to now. Best-effort; failure is logged but not
 * propagated. Called from auth context on every authenticated request.
 */
export async function touchAuthSession(sid: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(authSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(authSessions.sid, sid));
  } catch (err) {
    console.warn("[Database] touchAuthSession failed:", err);
  }
}

/**
 * List all sessions for a user (active + revoked, newest first).
 * Caller filters/marks the current session in the UI.
 */
export async function listActiveSessionsForUser(userId: number): Promise<AuthSession[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(authSessions)
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authSessions.lastActiveAt))
    .limit(50);
}

/**
 * Mark a single session as revoked. Idempotent.
 */
export async function revokeAuthSession(sid: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.sid, sid),
          isNull(authSessions.revokedAt),
        ),
      );
  } catch (err) {
    console.warn("[Database] revokeAuthSession failed:", err);
  }
}

/**
 * Revoke all active sessions for a user EXCEPT the one matching `exceptSid`.
 * Used by "Log out other devices" and after password change.
 * Pass undefined for `exceptSid` to log out everywhere.
 */
export async function revokeAllSessionsForUser(
  userId: number,
  exceptSid?: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const conditions = [
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
    ];
    if (exceptSid) {
      conditions.push(ne(authSessions.sid, exceptSid));
    }
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(...conditions));
  } catch (err) {
    console.warn("[Database] revokeAllSessionsForUser failed:", err);
  }
}

/**
 * Delete sessions that expired more than 7 days ago. Called periodically
 * by the scheduler so the table doesn't grow forever.
 */
export async function cleanupExpiredAuthSessions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    const result = await db
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, cutoff));
    return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
  } catch (err) {
    console.warn("[Database] cleanupExpiredAuthSessions failed:", err);
    return 0;
  }
}
