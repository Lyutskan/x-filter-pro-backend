/**
 * Auth Router
 * -----------
 * tRPC procedures for email/password authentication.
 *
 * Endpoints (called as `auth.signup`, `auth.login`, etc. from client):
 *   - signup(email, password, name?)        → create account, return JWT
 *   - login(email, password)                → verify creds, return JWT
 *   - me()                                  → return current user (protected)
 *   - logout()                              → no-op for JWT, kept for symmetry
 *   - changePassword(currentPw, newPw)      → re-hash and save (protected)
 *
 * All endpoints are public except `me`, `logout`, and `changePassword`.
 *
 * Rate limiting: applied at the Express middleware layer, not here.
 * Email verification: skipped for v2.0 (emailVerified defaults to true).
 *   We'll add verify-email + magic-link flows in v2.1 if needed.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  signJwt,
  verifyPassword,
} from "./_core/auth";
import {
  createUserWithPassword,
  getOrCreateSubscription,
  getUserByEmail,
  getUserById,
  touchLastSignedIn,
  updatePasswordHash,
} from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const signupInput = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional().nullable(),
});

const loginInput = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape returned from signup/login — matches what extension expects
// ─────────────────────────────────────────────────────────────────────────────

type AuthResponse = {
  token: string;
  user: {
    id: number;
    email: string;
    name: string | null;
    isPro: boolean;
  };
};

async function buildAuthResponse(
  userId: number,
  email: string,
  name: string | null,
  isPro: boolean,
): Promise<AuthResponse> {
  const token = await signJwt({ sub: String(userId), email });
  return {
    token,
    user: { id: userId, email, name, isPro },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const authRouter = router({
  /**
   * Sign up a new user with email + password.
   * - Validates email format and password strength via Zod
   * - Checks email isn't already registered
   * - Hashes password with bcrypt (cost 10)
   * - Creates user row + initial subscription row
   * - Returns JWT + user shape
   */
  signup: publicProcedure
    .input(signupInput)
    .mutation(async ({ input }): Promise<AuthResponse> => {
      const email = normalizeEmail(input.email);

      if (!isValidEmail(email)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please enter a valid email address.",
        });
      }

      // Reject if already registered. Use generic error message to avoid
      // user enumeration (don't tell attackers which emails exist).
      const existing = await getUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists. Try logging in.",
        });
      }

      const passwordHash = await hashPassword(input.password);

      let user;
      try {
        user = await createUserWithPassword(email, passwordHash, input.name ?? null);
      } catch (err) {
        // Race condition: someone signed up with this email between our check
        // and the insert. Surface as conflict.
        const msg = err instanceof Error ? err.message : "";
        if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An account with this email already exists.",
          });
        }
        console.error("[auth.signup] Failed to create user:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account. Please try again.",
        });
      }

      // Provision a free-plan subscription row so all downstream code can
      // assume `subscriptions[userId]` exists.
      try {
        await getOrCreateSubscription(user.id);
      } catch (err) {
        // Non-fatal: subscription will be created on first read.
        console.warn("[auth.signup] Subscription auto-create failed:", err);
      }

      return buildAuthResponse(user.id, user.email, input.name ?? null, false);
    }),

  /**
   * Log in an existing user with email + password.
   * - Always returns the same generic error for "wrong email" vs "wrong password"
   *   to prevent user-enumeration attacks
   * - Updates lastSignedIn on success
   */
  login: publicProcedure
    .input(loginInput)
    .mutation(async ({ input }): Promise<AuthResponse> => {
      const email = normalizeEmail(input.email);
      const GENERIC_ERROR = "Invalid email or password.";

      if (!isValidEmail(email)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: GENERIC_ERROR });
      }

      const user = await getUserByEmail(email);
      if (!user || !user.passwordHash) {
        // No account, or legacy Manus user (no password). Same error either way.
        throw new TRPCError({ code: "UNAUTHORIZED", message: GENERIC_ERROR });
      }

      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: GENERIC_ERROR });
      }

      // Best-effort timestamp update; don't block login if it fails.
      void touchLastSignedIn(user.id);

      return buildAuthResponse(user.id, user.email, user.name ?? null, user.isPro);
    }),

  /**
   * Return the current user's profile. Used by client to refresh state
   * after page reload (when only the JWT is in storage).
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    // Re-fetch from DB so we get fresh isPro status (might have changed
    // due to webhook between login and now).
    const fresh = await getUserById(ctx.user.id);
    if (!fresh) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    return {
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      isPro: fresh.isPro,
      role: fresh.role,
    };
  }),

  /**
   * Logout is a client-side concern with JWT (just delete the token).
   * We expose this endpoint so the existing extension code that calls
   * `auth.logout` continues to work without errors.
   *
   * Future: if we add a revocation list, this is where we'd insert.
   */
  logout: protectedProcedure.mutation(async () => {
    return { success: true };
  }),

  /**
   * Change password while logged in. Requires current password to prevent
   * session-hijack attacks (someone who steals the JWT can't lock the user out).
   */
  changePassword: protectedProcedure
    .input(changePasswordInput)
    .mutation(async ({ ctx, input }) => {
      const fresh = await getUserById(ctx.user.id);
      if (!fresh || !fresh.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This account doesn't have a password set.",
        });
      }

      const ok = await verifyPassword(input.currentPassword, fresh.passwordHash);
      if (!ok) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect.",
        });
      }

      const newHash = await hashPassword(input.newPassword);
      await updatePasswordHash(fresh.id, newHash);
      return { success: true };
    }),
});

export type AuthRouter = typeof authRouter;
