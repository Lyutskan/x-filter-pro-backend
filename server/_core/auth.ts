/**
 * Auth Helper Module
 * --------------------
 * Centralized password hashing, JWT generation, and token verification.
 *
 * Why JWT (not server-side sessions)?
 * - Stateless: scales horizontally without sticky sessions or shared session store
 * - Cross-origin: works for both extension (no cookies) and site (cookies)
 * - Tooling: jose library is already a dep, mature and well-audited
 *
 * Why bcryptjs (not bcrypt)?
 * - Pure JS, no native bindings → no Docker/Railway build issues
 * - Slightly slower (~100ms vs 50ms) but imperceptible to users
 *
 * Token rotation?
 * - For v2.0 we issue tokens with 30-day expiry, no refresh-token flow yet.
 * - Adding refresh tokens later is straightforward (separate "refresh" table).
 */

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 10; // industry standard; 12 if you want stronger but slower
const JWT_ALGORITHM = "HS256";
const JWT_EXPIRY = "30d";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET env var must be set and at least 32 characters. " +
      "Generate one with: openssl rand -base64 48"
    );
  }
  return new TextEncoder().encode(secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// Password hashing
// ─────────────────────────────────────────────────────────────────────────────

export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string | null
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT
// ─────────────────────────────────────────────────────────────────────────────

export type JwtPayload = {
  sub: string; // user id (as string)
  email: string;
  sid: string; // session id (UUID-like)
};

export async function signJwt(payload: JwtPayload): Promise<string> {
  return new SignJWT({ email: payload.email, sid: payload.sid })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret());
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (
      !payload.sub ||
      typeof payload.email !== "string" ||
      typeof payload.sid !== "string"
    ) {
      // Old-format token without sid — treat as invalid (forces re-login).
      // After v2.1 deploy, all tokens will have sid.
      return null;
    }
    return { sub: payload.sub, email: payload.email, sid: payload.sid };
  } catch {
    // Expired, malformed, or signature mismatch — all treated as "not authed".
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email validation (basic)
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 320) return false;
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
