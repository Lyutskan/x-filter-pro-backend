/**
 * Admin Router
 * ────────────
 * Dashboard endpoints. All procedures use `adminProcedure`, which checks
 * `ctx.user.role === 'admin'` — non-admins get 403.
 *
 * Endpoints:
 *   - kpis()                   → top-of-dashboard counters
 *   - signupsByDay()           → signup line chart
 *   - aiUsageByDay()           → AI usage line chart
 *   - recentSignups()          → last 20 signups
 *   - activeProUsers()         → all current Pro members
 *   - recentPayments()         → last 20 payment-related events
 *
 * Privacy note:
 *   Even admins should not see passwordHash. The DB helpers only return
 *   the fields explicitly listed; nothing leaks accidentally.
 */

import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import {
  getActiveProUsers,
  getAdminKpis,
  getAiUsageByDay,
  getRecentPayments,
  getRecentSignups,
  getSignupsByDay,
} from "./db";

export const adminRouter = router({
  /**
   * Top-of-dashboard KPIs. Lightweight (~50ms), suitable for periodic refresh.
   * Front-end can poll every 30-60 s if you want a live feel.
   */
  kpis: adminProcedure.query(async () => {
    return getAdminKpis();
  }),

  /**
   * Daily signup counts for the last `days` days. Default 30.
   */
  signupsByDay: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input }) => {
      return getSignupsByDay(input?.days ?? 30);
    }),

  /**
   * Daily AI summary counts for the last `days` days. Default 30.
   */
  aiUsageByDay: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input }) => {
      return getAiUsageByDay(input?.days ?? 30);
    }),

  /**
   * Most-recent signups, newest first.  Sensitive fields (password hash)
   * are excluded at the DB layer.
   */
  recentSignups: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(20) }).optional())
    .query(async ({ input }) => {
      return getRecentSignups(input?.limit ?? 20);
    }),

  /**
   * All currently-active Pro users.
   */
  activeProUsers: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }).optional())
    .query(async ({ input }) => {
      return getActiveProUsers(input?.limit ?? 50);
    }),

  /**
   * Recent payment-related subscription updates.  Not a true payments log,
   * but a useful approximation until we add a dedicated `payments` table.
   */
  recentPayments: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(20) }).optional())
    .query(async ({ input }) => {
      return getRecentPayments(input?.limit ?? 20);
    }),
});

export type AdminRouter = typeof adminRouter;
