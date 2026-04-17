
import { eq, and, gt, gte, lte, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  subscriptions,
  seenTweets,
  dailyStats,
  filterRules,
  mutedAccounts,
  aiUsageLog,
  deviceSessions,
  type Subscription,
  type SeenTweet,
  type DailyStat,
  type FilterRule,
  type MutedAccount,
  type AiUsageLog,
  type DeviceSession,
} from "../drizzle/schema";
import { ENV } from './_core/env';

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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  if (result.length === 0) return undefined;

  const user = result[0];

  // Ensure subscription exists
  await getOrCreateSubscription(user.id);

  return user;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
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


// ===== v2: Email/Password Auth Helpers =====

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  return (rows[0] as User) ?? null;
}

export async function createEmailUser(params: {
  email: string;
  name: string | null;
  passwordHash: string;
}): Promise<User> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalized = params.email.trim().toLowerCase();
  const result = await db.insert(users).values({
    email: normalized,
    name: params.name,
    authProvider: "email",
    passwordHash: params.passwordHash,
    emailVerified: false,
    role: "user",
    isPro: false,
  });
  const insertId = (result as any)?.[0]?.insertId ?? (result as any)?.insertId;
  if (!insertId || typeof insertId !== "number") {
    throw new Error("Failed to obtain insertId after createEmailUser");
  }
  const created = await getUserById(insertId);
  if (!created) throw new Error("User created but could not be read back");
  return created;
}

export async function touchLastSignedIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

// ===== v2: AI Daily Usage Helper =====

export async function getAiUsageToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select()
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.userId, userId), gte(aiUsageLog.createdAt, utcMidnight)));
  return rows.length;
}

// Auto-migration: add auth columns (using query, not execute)
setTimeout(async () => {
  try {
    const db = await getDb();
    if (!db) return;
    const pool = (db as any).$client;
    if (!pool?.query) { console.log("[Migration] no pool"); return; }
    const queries = [
      "ALTER TABLE users ADD COLUMN authProvider ENUM('email','google') NOT NULL DEFAULT 'email'",
      "ALTER TABLE users ADD COLUMN passwordHash VARCHAR(512) NULL",
      "ALTER TABLE users ADD COLUMN emailVerified BOOLEAN NOT NULL DEFAULT false",
      "ALTER TABLE users MODIFY COLUMN openId VARCHAR(64) NULL",
    ];
    for (const q of queries) {
      try { await pool.query(q); console.log("[Migration] OK:", q.slice(24, 65)); }
      catch (e: any) {
        if (e?.code === "ER_DUP_FIELDNAME") console.log("[Migration] exists, OK");
        else console.log("[Migration] err:", e?.code, e?.sqlMessage);
      }
    }
    console.log("[Migration] All done!");
  } catch (e: any) { console.log("[Migration] failed:", e?.message?.slice(0, 120)); }
}, 5000);
