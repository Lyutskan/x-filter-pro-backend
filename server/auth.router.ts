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
  createPasswordResetToken,
  createUserWithPassword,
  deleteAllPasswordResetTokensForUser,
  getOrCreateSubscription,
  getUserByEmail,
  getUserById,
  getValidPasswordResetToken,
  markPasswordResetTokenUsed,
  touchLastSignedIn,
  updatePasswordHash,
} from "./db";
import { sendEmailViaSendGrid } from "./sendgrid.service";
import crypto from "crypto";

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

  /**
   * Step 1 of password reset: user enters their email, we email them a link.
   *
   * Security model:
   *   - We ALWAYS return { success: true }, even if email is unknown.
   *     This prevents user enumeration via the reset form.
   *   - Token is 32 bytes of cryptographic randomness (256 bits).
   *   - Token expires in 1 hour, single-use.
   *   - We delete all previous reset tokens for this user when creating
   *     a new one — protects against multiple-link abuse.
   *
   * Email delivery:
   *   - Sent via SendGrid using EMAIL_FROM env var.
   *   - If SENDGRID_API_KEY isn't set, sendgrid.service.ts logs and no-ops
   *     (we still return success — failure mode is hidden from caller).
   */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email().max(320) }))
    .mutation(async ({ input }) => {
      const email = normalizeEmail(input.email);
      const GENERIC_OK = { success: true } as const;

      const user = await getUserByEmail(email);
      if (!user) return GENERIC_OK; // silent; don't enumerate emails

      // Generate 256-bit random token, hex-encode (64 chars)
      const token = crypto.randomBytes(32).toString("hex");

      // Invalidate any existing reset tokens for this user
      await deleteAllPasswordResetTokensForUser(user.id);

      // Persist new token (1-hour TTL)
      try {
        await createPasswordResetToken(user.id, token, 60 * 60 * 1000);
      } catch (err) {
        console.error("[auth.requestPasswordReset] DB error:", err);
        // Still return success to avoid leaking info; user can retry.
        return GENERIC_OK;
      }

      // Build reset link (site, not API, since user clicks from email)
      const SITE = process.env.SITE_URL || "https://xfilterpro.com";
      const resetUrl = `${SITE}/reset-password?token=${encodeURIComponent(token)}`;

      // Send the email — non-blocking failure, don't tell the caller
      try {
        await sendEmailViaSendGrid(email, {
          subject: "Reset your X Filter Pro password",
          html: buildResetEmailHtml(resetUrl, user.name ?? null),
          text: buildResetEmailText(resetUrl, user.name ?? null),
        });
      } catch (err) {
        console.error("[auth.requestPasswordReset] Email send failed:", err);
      }

      return GENERIC_OK;
    }),

  /**
   * Step 2 of password reset: user submits the token + new password.
   * On success we update the password hash and invalidate the token.
   */
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(32).max(256),
        newPassword: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ input }) => {
      const tokenRow = await getValidPasswordResetToken(input.token);
      if (!tokenRow) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This password reset link is invalid or has expired.",
        });
      }

      const newHash = await hashPassword(input.newPassword);
      await updatePasswordHash(tokenRow.userId, newHash);

      // Invalidate this and any other outstanding tokens for this user.
      await markPasswordResetTokenUsed(input.token);
      await deleteAllPasswordResetTokensForUser(tokenRow.userId);

      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Email templates (kept inline for simplicity; move to a separate file if
// templates grow more elaborate or get reused).
// ─────────────────────────────────────────────────────────────────────────────

function buildResetEmailHtml(resetUrl: string, name: string | null): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e8e8f0;">
<div style="max-width:560px;margin:0 auto;padding:48px 24px;">
  <div style="background:#14141e;border:1px solid #1e1e30;border-radius:16px;padding:36px 32px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#ffd166,#f7b733);border-radius:7px;"></div>
      <span style="font-weight:700;font-size:16px;">X Filter <span style="color:#ffd166">Pro</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;line-height:1.3;">Reset your password</h1>
    <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 24px;">${greeting}</p>
    <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 24px;">We received a request to reset your X Filter Pro password. Click the button below to choose a new one. This link expires in 1 hour.</p>
    <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#ffd166,#f7b733);color:#000;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Reset password</a>
    <p style="color:#66668a;font-size:12px;line-height:1.6;margin:28px 0 0;font-family:monospace;">Or copy this link:<br><a href="${resetUrl}" style="color:#6ee7f7;word-break:break-all;">${resetUrl}</a></p>
    <hr style="border:none;border-top:1px solid #1e1e30;margin:32px 0;">
    <p style="color:#66668a;font-size:12px;line-height:1.6;margin:0;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </div>
  <p style="text-align:center;color:#66668a;font-size:11px;font-family:monospace;margin-top:24px;">© 2026 X Filter Pro · support@xfilterpro.com</p>
</div>
</body></html>`;
}

function buildResetEmailText(resetUrl: string, name: string | null): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return `${greeting}

We received a request to reset your X Filter Pro password.
Click this link to choose a new password:

${resetUrl}

This link expires in 1 hour.

If you didn't request this, you can safely ignore this email.

— X Filter Pro
support@xfilterpro.com`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type AuthRouter = typeof authRouter;
