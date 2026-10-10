/**
 * Stats Router (Phase 1)
 * ---------------------
 * Public + protected aggregate metrics endpoints.
 *
 *   dailyPush(date, hidden, seen, timeSaved)
 *     → Protected. Extension auth'd push (1/hour rate-limit).
 *     → Upserts dailyStats row for user/date.
 *
 *   anonymousTick(hiddenIncrement, linkIncrement)
 *     → Public. Opt-in via extension setting.
 *     → IP hashed with daily-rotating salt. Country from Cloudflare header.
 *     → Rate-limited 100/day/IP (silent reject — no error to bot).
 *
 *   publicAggregate()
 *     → Public. Returns cached aggregate metrics for the trust widget.
 *     → 15-min in-memory cache. Combines dailyStats + anonymousStats.
 *
 * Privacy:
 *   - Anonymous endpoint hashes IP with a daily-rotating salt.
 *   - Daily salt makes cross-day tracking impossible.
 *   - No tweet text, no URLs, no account names collected here.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createHash } from "crypto";
import type { Request } from "express";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  computePublicAggregate,
  upsertDailyStat,
  upsertAnonymousStat,
} from "./db";

// ─── Rate limiting (in-memory, resets on PM2 restart) ───
const authPushCounter = new Map<string, number>(); // "userId:date" -> count
const anonTickCounter = new Map<string, { count: number; firstAt: number }>();

const AUTH_PUSH_DAILY_CAP = 24; // 1 per hour
const ANON_TICK_DAILY_CAP = 100;
const ANON_HIDDEN_DAILY_CAP = 10000;

// ─── Public aggregate cache (in-memory) ───
type CachedAggregate = {
  data: Awaited<ReturnType<typeof computePublicAggregate>>;
  ts: number;
};
let aggregateCache: CachedAggregate | null = null;
const AGGREGATE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

// ─── Daily-rotating salt for IP hashing ───
function getDailySalt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const baseSalt = process.env.ANON_STATS_SALT || "xfp-default-stats-salt-rotate-me";
  return `${baseSalt}:${today}`;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + getDailySalt()).digest("hex");
}

function extractClientIp(req: Request): string {
  // Cloudflare → nginx → Express
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.length > 0) return cfIp;

  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length > 0) {
    return xfwd.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "0.0.0.0";
}

function extractCountryCode(req: Request): string | null {
  const cc = req.headers["cf-ipcountry"];
  if (typeof cc === "string" && cc.length === 2 && cc !== "XX") {
    return cc.toUpperCase();
  }
  return null;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Input schemas ───
const dailyPushInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hiddenCount: z.number().int().min(0).max(10000),
  seenCount: z.number().int().min(0).max(100000).default(0),
  estimatedTimeSaved: z.number().int().min(0).max(86400).default(0),
});

const anonymousTickInput = z.object({
  hiddenIncrement: z.number().int().min(0).max(100),
  linkIncrement: z.number().int().min(0).max(100).default(0),
});

// ─── Router ───
export const statsRouter = router({
  /**
   * Authenticated daily stats push.
   * Used by logged-in extension installs to upsert their day's counters.
   * Rate-limited: 24 pushes per user per day (~1 per hour).
   */
  dailyPush: protectedProcedure
    .input(dailyPushInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const key = `${userId}:${input.date}`;
      const currentCount = authPushCounter.get(key) ?? 0;

      if (currentCount >= AUTH_PUSH_DAILY_CAP) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Push rate limit exceeded (max 24/day). Try again later.",
        });
      }

      await upsertDailyStat(userId, input.date, {
        hiddenCount: input.hiddenCount,
        seenCount: input.seenCount,
        estimatedTimeSaved: input.estimatedTimeSaved,
      });

      authPushCounter.set(key, currentCount + 1);
      return { ok: true, remaining: AUTH_PUSH_DAILY_CAP - currentCount - 1 };
    }),

  /**
   * Public anonymous tick — opt-in via extension setting.
   * Rate-limited 100/day per IP-hash. Silent reject on cap (no error to bots).
   */
  anonymousTick: publicProcedure
    .input(anonymousTickInput)
    .mutation(async ({ ctx, input }) => {
      const ip = extractClientIp(ctx.req);
      const country = extractCountryCode(ctx.req);
      const ipHash = hashIp(ip);
      const date = todayDate();

      // Rate limit per IP per day (in-memory)
      const cacheKey = `${ipHash}:${date}`;
      const now = Date.now();
      const tick = anonTickCounter.get(cacheKey);

      if (tick) {
        // If first tick was today, count
        if (now - tick.firstAt < 86400_000) {
          if (tick.count >= ANON_TICK_DAILY_CAP) {
            // Silent reject — don't tell bots they hit the cap
            return { ok: true };
          }
          tick.count++;
        } else {
          // Reset for new day
          anonTickCounter.set(cacheKey, { count: 1, firstAt: now });
        }
      } else {
        anonTickCounter.set(cacheKey, { count: 1, firstAt: now });
      }

      // DB hard cap (defense in depth)
      try {
        await upsertAnonymousStat(
          ipHash,
          date,
          country,
          input.hiddenIncrement,
          input.linkIncrement,
        );
      } catch (err) {
        console.error("[stats] anonymousTick db error:", err);
        // Don't fail the request — anonymous stats are best-effort
      }

      return { ok: true };
    }),

  /**
   * Public aggregate for trust widget.
   * Cached 15min in-memory. Returns 0s if no data (widget hides itself).
   */
  publicAggregate: publicProcedure.query(async () => {
    const now = Date.now();
    if (aggregateCache && now - aggregateCache.ts < AGGREGATE_CACHE_TTL_MS) {
      return aggregateCache.data;
    }

    const data = await computePublicAggregate();
    aggregateCache = { data, ts: now };
    return data;
  }),
});

export type StatsRouter = typeof statsRouter;
