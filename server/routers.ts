/**
 * tRPC App Router
 *
 * FAZA 1 değişiklik:
 *  - Yeni authRouter bağlandı (email/password)
 *  - Eski auth.me ve auth.logout authRouter içine taşındı
 *  - Manus OAuth (sdk.ts üzerinden) artık kullanılmıyor
 */

import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authRouter } from "./auth.router";
import { xfilterRouter } from "./xfilter.router";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  xfilter: xfilterRouter,
});

export type AppRouter = typeof appRouter;
export { xfilterRouter, authRouter };
export type { XFilterRouter } from "./xfilter.router";
export type { AuthRouter } from "./auth.router";
