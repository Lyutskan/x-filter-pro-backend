import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, decimal, index } from "drizzle-orm/mysql-core";

/**
 * X Filter Pro — Database Schema
 *
 * FAZA 1 CHANGES (email/password auth):
 *  - users.openId: now nullable (only filled for legacy Manus/OAuth users)
 *  - users.email: now NOT NULL + UNIQUE (primary identifier for email auth)
 *  - users.authProvider: new column, which auth flow created this user
 *  - users.passwordHash: new column, scrypt hash (format: "scrypt$N$r$p$salt$hash")
 *  - users.emailVerified: new column, for future email verification flow
 *
 *  openId remains so that disabled OAuth code keeps compiling. It can be
 *  removed entirely once we're certain we don't want Manus/OAuth back.
 */

/**
 * Core users table — supports both email/password and (disabled) OAuth.
 */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),

    // Primary identifier for email auth. Unique + NOT NULL.
    email: varchar("email", { length: 320 }).notNull().unique(),

    // Display name (optional for email signup, filled from OAuth when present).
    name: text("name"),

    // Auth provider that created/owns this user.
    // "email"  = email+password (scrypt hash in passwordHash)
    // "google" = future Google OAuth
    // "manus"  = legacy Manus OAuth (disabled in FAZA 1)
    authProvider: mysqlEnum("authProvider", ["email", "google", "manus"]).default("email").notNull(),

    // scrypt hash, format: "scrypt$N$r$p$saltHex$hashHex"
    // NULL for OAuth users (who never set a password).
    passwordHash: varchar("passwordHash", { length: 512 }),

    // Future: set to true after user clicks verification link.
    // FAZA 1 default = false, we don't enforce verification yet.
    emailVerified: boolean("emailVerified").default(false).notNull(),

    // Legacy Manus OAuth identifier. Nullable now. Only set for users who came via OAuth.
    openId: varchar("openId", { length: 64 }).unique(),

    // Legacy field, kept for compatibility.
    loginMethod: varchar("loginMethod", { length: 64 }),

    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),

    // Pro status — denormalized cache of subscriptions.isPro, for fast reads.
    isPro: boolean("isPro").default(false).notNull(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  })
);

export type User = typeof users.$inferSelect & { isPro: boolean };
export type InsertUser = typeof users.$inferInsert & { isPro?: boolean };

/**
 * Pro Plan ve Subscription Yönetimi
 */
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  isPro: boolean("isPro").default(false).notNull(),
  // Free: 500 hidden tweets/month. Pro: unlimited (enforced in server).
  monthlyLimit: int("monthlyLimit").default(500).notNull(),
  aiUsageCount: int("aiUsageCount").default(0).notNull(),
  // FAZA 1: these are now DAILY AI limits, not monthly.
  // Free: 5/day, Pro: 50/day. (Kept column name to avoid migration churn;
  // interpretation changes in checkAiLimit logic.)
  aiMonthlyLimit: int("aiMonthlyLimit").default(5).notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  renewalDate: timestamp("renewalDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

/**
 * Görülen Tweetler (Seen Tweets) - Cihazlar arası senkronizasyon
 */
export const seenTweets = mysqlTable(
  "seenTweets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    tweetFingerprint: varchar("tweetFingerprint", { length: 255 }).notNull(),
    tweetId: varchar("tweetId", { length: 64 }),
    seenAt: timestamp("seenAt").defaultNow().notNull(),
    snoozeUntil: timestamp("snoozeUntil"),
    snoozeShown: boolean("snoozeShown").default(false).notNull(),
    hiddenReason: varchar("hiddenReason", { length: 50 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("seenTweets_userId_idx").on(table.userId),
    snoozeUntilIdx: index("seenTweets_snoozeUntil_idx").on(table.snoozeUntil),
  })
);

export type SeenTweet = typeof seenTweets.$inferSelect;
export type InsertSeenTweet = typeof seenTweets.$inferInsert;

/**
 * Günlük İstatistikler
 */
export const dailyStats = mysqlTable(
  "dailyStats",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
    hiddenCount: int("hiddenCount").default(0).notNull(),
    seenCount: int("seenCount").default(0).notNull(),
    estimatedTimeSaved: int("estimatedTimeSaved").default(0).notNull(),
    topAccounts: json("topAccounts"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdDateIdx: index("dailyStats_userId_date_idx").on(table.userId, table.date),
  })
);

export type DailyStat = typeof dailyStats.$inferSelect;
export type InsertDailyStat = typeof dailyStats.$inferInsert;

/**
 * Filtreleme Kuralları
 */
export const filterRules = mysqlTable(
  "filterRules",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    ruleType: mysqlEnum("ruleType", [
      "keyword",
      "account",
      "link",
      "promoted",
      "follower_count",
      "account_age",
      "like_count",
      "retweet_count",
    ]).notNull(),
    ruleValue: text("ruleValue").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    priority: int("priority").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("filterRules_userId_idx").on(table.userId),
  })
);

export type FilterRule = typeof filterRules.$inferSelect;
export type InsertFilterRule = typeof filterRules.$inferInsert;

/**
 * Sessize Alınan Hesaplar
 */
export const mutedAccounts = mysqlTable(
  "mutedAccounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountHandle: varchar("accountHandle", { length: 100 }).notNull(),
    muteUntil: timestamp("muteUntil"),
    reason: text("reason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("mutedAccounts_userId_idx").on(table.userId),
  })
);

export type MutedAccount = typeof mutedAccounts.$inferSelect;
export type InsertMutedAccount = typeof mutedAccounts.$inferInsert;

/**
 * AI Kullanım Tracking
 */
export const aiUsageLog = mysqlTable(
  "aiUsageLog",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    operationType: mysqlEnum("operationType", ["summarize", "translate", "analyze"]).notNull(),
    inputTokens: int("inputTokens").default(0).notNull(),
    outputTokens: int("outputTokens").default(0).notNull(),
    estimatedCost: decimal("estimatedCost", { precision: 10, scale: 6 }).default("0").notNull(),
    responseTime: int("responseTime").notNull(),
    status: mysqlEnum("status", ["success", "failed", "rate_limited"]).default("success").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("aiUsageLog_userId_idx").on(table.userId),
    // FAZA 1: index for "today's usage" queries.
    userCreatedIdx: index("aiUsageLog_userId_createdAt_idx").on(table.userId, table.createdAt),
  })
);

export type AiUsageLog = typeof aiUsageLog.$inferSelect;
export type InsertAiUsageLog = typeof aiUsageLog.$inferInsert;

/**
 * Cihaz Senkronizasyonu
 */
export const deviceSessions = mysqlTable(
  "deviceSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: varchar("deviceId", { length: 255 }).notNull(),
    browserType: mysqlEnum("browserType", ["chrome", "firefox", "opera", "edge", "other"]).notNull(),
    deviceName: varchar("deviceName", { length: 255 }),
    lastSyncedAt: timestamp("lastSyncedAt").defaultNow().notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("deviceSessions_userId_idx").on(table.userId),
  })
);

export type DeviceSession = typeof deviceSessions.$inferSelect;
export type InsertDeviceSession = typeof deviceSessions.$inferInsert;
