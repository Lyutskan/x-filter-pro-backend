import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, decimal, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
/**
 * Kullanıcı tablosu - Manus OAuth ile entegre
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  isPro: boolean("isPro").default(false).notNull(), // Pro status (subscription tablosundan senkronize edilir)
});

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
  monthlyLimit: int("monthlyLimit").default(500).notNull(), // Free: 500, Pro: unlimited
  aiUsageCount: int("aiUsageCount").default(0).notNull(),
  aiMonthlyLimit: int("aiMonthlyLimit").default(10).notNull(), // Free: 10, Pro: unlimited
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
    tweetFingerprint: varchar("tweetFingerprint", { length: 255 }).notNull(), // Tweet ID veya text+user hash
    tweetId: varchar("tweetId", { length: 64 }),
    seenAt: timestamp("seenAt").defaultNow().notNull(),
    snoozeUntil: timestamp("snoozeUntil"), // 24 saat sonra tekrar gösterilecek
    snoozeShown: boolean("snoozeShown").default(false).notNull(), // Snooze süresi geçti mi?
    hiddenReason: varchar("hiddenReason", { length: 50 }), // "keyword", "link", "promoted", "muted", etc.
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
    hiddenCount: int("hiddenCount").default(0).notNull(), // Gizlenen tweet sayısı
    seenCount: int("seenCount").default(0).notNull(), // Görülen tweet sayısı
    estimatedTimeSaved: int("estimatedTimeSaved").default(0).notNull(), // Saniye cinsinden
    topAccounts: json("topAccounts"), // { "@account": count, ... }
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
 * Filtreleme Kuralları (Sunucu tarafında saklanır)
 */
export const filterRules = mysqlTable(
  "filterRules",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    ruleType: mysqlEnum("ruleType", ["keyword", "account", "link", "promoted", "follower_count", "account_age", "like_count", "retweet_count"]).notNull(),
    ruleValue: text("ruleValue").notNull(), // JSON veya string
    isActive: boolean("isActive").default(true).notNull(),
    priority: int("priority").default(0).notNull(), // Daha yüksek = önce çalıştırılır
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
 * Sessize Alınan Hesaplar (Muted Accounts)
 */
export const mutedAccounts = mysqlTable(
  "mutedAccounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountHandle: varchar("accountHandle", { length: 100 }).notNull(), // @username
    muteUntil: timestamp("muteUntil"), // null = permanent
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
 * AI Kullanım Tracking (Maliyet Kontrolü)
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
    responseTime: int("responseTime").notNull(), // Milisaniye
    status: mysqlEnum("status", ["success", "failed", "rate_limited"]).default("success").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("aiUsageLog_userId_idx").on(table.userId),
  })
);

export type AiUsageLog = typeof aiUsageLog.$inferSelect;
export type InsertAiUsageLog = typeof aiUsageLog.$inferInsert;

/**
 * Cihaz Senkronizasyonu (Chrome, Firefox, Opera)
 */
export const deviceSessions = mysqlTable(
  "deviceSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: varchar("deviceId", { length: 255 }).notNull(), // UUID
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