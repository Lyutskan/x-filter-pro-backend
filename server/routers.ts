import { authRouter } from "./auth.router";
import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { xfilterRouter } from "./xfilter.router";

/**
 * Top-level tRPC router. Exposes three namespaces:
 *
 *   system   - infrastructure/health endpoints
 *   auth     - email/password signup, login, me, logout, changePassword
 *   xfilter  - product features (filters, AI, sync, etc.)
 *
 * v2.0 change: replaced legacy Manus OAuth `auth.me` / `auth.logout` (cookie-
 * based) with a full email/password router defined in `auth.router.ts`.
 */
export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  xfilter: xfilterRouter,
});

export type AppRouter = typeof appRouter;
export { xfilterRouter };
export type { XFilterRouter } from "./xfilter.router";
