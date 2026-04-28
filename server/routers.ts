import { adminRouter } from "./admin.router";
import { authRouter } from "./auth.router";
import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { xfilterRouter } from "./xfilter.router";

/**
 * Top-level tRPC router. Exposes four namespaces:
 *
 *   system   - infrastructure/health endpoints
 *   auth     - email/password signup, login, me, logout, changePassword
 *   xfilter  - product features (filters, AI, sync, etc.)
 *   admin    - dashboard queries (admin-only)
 */
export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  xfilter: xfilterRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
export { xfilterRouter };
export type { XFilterRouter } from "./xfilter.router";
