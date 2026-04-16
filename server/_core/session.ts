/**
 * Session JWT helper
 *
 * FAZA 1 — X Filter Pro
 *
 * Generic session token sign/verify. Manus'a bağımlı değil.
 * Hem email/password hem de (gelecekte) OAuth kullanıcıları için aynı token formatı.
 *
 * Format: jose HS256 JWT, payload:
 *   {
 *     uid: number,        // users.id (primary key)
 *     email: string,
 *     provider: "email" | "google" | "manus",
 *     iat: number,        // jose otomatik ekler
 *     exp: number,        // jose otomatik ekler
 *   }
 *
 * Token tek taraflıdır — kullanıcıya verdikten sonra değiştiremeyiz (Pro status gibi).
 * Pro değişikliklerini tokena gömmüyoruz; her istekte DB'den okuyoruz.
 */

import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

export type SessionPayload = {
  uid: number;
  email: string;
  provider: "email" | "google" | "manus";
};

const ALGORITHM = "HS256";
const DEFAULT_EXPIRY_DAYS = 30;

function getSecret(): Uint8Array {
  const secret = ENV.cookieSecret;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET environment variable is missing or too short (min 32 chars). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Yeni bir session token imzala.
 */
export async function signSession(
  payload: SessionPayload,
  options: { expiresInDays?: number } = {}
): Promise<string> {
  const days = options.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + days * 24 * 60 * 60;

  return new SignJWT({
    uid: payload.uid,
    email: payload.email,
    provider: payload.provider,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());
}

/**
 * Token'ı doğrula. Geçersiz/expired ise null döner (throw etmez).
 */
export async function verifySession(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALGORITHM] });

    const uid = payload["uid"];
    const email = payload["email"];
    const provider = payload["provider"];

    if (typeof uid !== "number" || typeof email !== "string" || typeof provider !== "string") {
      return null;
    }

    if (provider !== "email" && provider !== "google" && provider !== "manus") {
      return null;
    }

    return { uid, email, provider };
  } catch {
    // Expired, invalid signature, malformed — hepsi null.
    return null;
  }
}

/**
 * HTTP Authorization header'dan Bearer token'ı çıkar.
 */
export function extractBearerToken(authHeader: string | undefined | string[]): string | null {
  if (!authHeader) return null;
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof header !== "string") return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Cookie header'dan spesifik bir cookie'yi parse et (3rd party cookie parser gerektirmez).
 */
export function extractCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(eqIdx + 1).trim());
    }
  }
  return null;
}
