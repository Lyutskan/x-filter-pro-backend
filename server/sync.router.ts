/**
 * Cloud Sync Router
 * -----------------
 * tRPC procedures for syncing extension state across devices.
 *
 *   pull()         → Pro: get latest state. Free: { available: false }
 *   push(state)    → Pro only. Rate limited 10/min. Free: 403 FORBIDDEN.
 *   status()       → Always returns: isPro flag + lastSyncedAt
 *
 * Rate limiting is in-process (Map). PM2 restart resets counters.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  getUserById,
  getUserSyncState,
  upsertUserSyncState,
} from "./db";

const pushRateLimit = new Map<number, number[]>();
const RATE_LIMIT_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(userId: number): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (pushRateLimit.get(userId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    const retryAfter = Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  recent.push(now);
  pushRateLimit.set(userId, recent);
  return { allowed: true, remaining: RATE_LIMIT_PER_MINUTE - recent.length, retryAfter: 0 };
}

const syncPushInput = z.object({
  seenCountTotal: z.number().int().min(0).optional(),
  mutedAccounts: z.unknown().optional(),
  filterRules: z.unknown().optional(),
  toggleSettings: z.unknown().optional(),
});

function safeJsonParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export const syncRouter = router({
  pull: protectedProcedure.query(async ({ ctx }) => {
    const user = await getUserById(ctx.user.id);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (!user.isPro) {
      return { available: false, reason: "pro_required", state: null, lastSyncedAt: null };
    }
    const row = await getUserSyncState(ctx.user.id);
    if (!row) return { available: true, state: null, lastSyncedAt: null };
    return {
      available: true,
      state: {
        seenCountTotal: row.seenCountTotal,
        mutedAccounts: row.mutedAccounts ? safeJsonParse(row.mutedAccounts, [] as string[]) : [],
        filterRules: row.filterRules ? safeJsonParse(row.filterRules, {} as Record<string, unknown>) : {},
        toggleSettings: row.toggleSettings ? safeJsonParse(row.toggleSettings, {} as Record<string, unknown>) : {},
      },
      lastSyncedAt: row.lastSyncedAt,
    };
  }),

  push: protectedProcedure
    .input(syncPushInput)
    .mutation(async ({ ctx, input }) => {
      const user = await getUserById(ctx.user.id);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (!user.isPro) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cloud Sync is a Pro feature. Upgrade at xfilterpro.com",
        });
      }
      const rate = checkRateLimit(ctx.user.id);
      if (!rate.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many sync requests. Please wait ${rate.retryAfter} seconds.`,
        });
      }
      await upsertUserSyncState(ctx.user.id, {
        seenCountTotal: input.seenCountTotal,
        mutedAccounts: input.mutedAccounts !== undefined ? JSON.stringify(input.mutedAccounts) : undefined,
        filterRules: input.filterRules !== undefined ? JSON.stringify(input.filterRules) : undefined,
        toggleSettings: input.toggleSettings !== undefined ? JSON.stringify(input.toggleSettings) : undefined,
      });
      return { success: true, syncedAt: new Date(), remaining: rate.remaining };
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const user = await getUserById(ctx.user.id);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (!user.isPro) return { available: false, isPro: false, lastSyncedAt: null };
    const row = await getUserSyncState(ctx.user.id);
    return { available: true, isPro: true, lastSyncedAt: row?.lastSyncedAt ?? null };
  }),
});
