/**
 * Password hashing helper (scrypt, Node built-in crypto)
 *
 * FAZA 1 — X Filter Pro
 *
 * Neden scrypt:
 *  - bcryptjs pure JS ama yavaş (~200ms/hash, cold-start problemleri)
 *  - bcrypt native ama Railway build'de compile sorunları çıkarabilir
 *  - scrypt Node'un kendi crypto modülünde, ek bağımlılık gerekmez, memory-hard
 *
 * Format:
 *   "scrypt$N$r$p$saltHex$hashHex"
 *   Örn:  "scrypt$16384$8$1$a7b3...$f2c1..."
 *
 * Bu format gelecekte parametre değiştirirsek (daha güçlü N, r, p) geriye uyumlu kalır —
 * her hash kendi parametrelerini taşır, verify sırasında kullanırız.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt parametreleri — OWASP 2024 önerisi:
// N=2^14 (16384), r=8, p=1, 64 byte output
// Bu modern CPU'da ~100ms alır, brute-force için yeterince yavaş.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Plaintext password'ü hash'ler.
 * Farklı çağrılar farklı salt ürettiği için aynı password için farklı hash'ler döner — normal.
 */
export function hashPassword(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  if (plaintext.length > 1024) {
    // DoS koruması: çok uzun password'ler scrypt'i yavaşlatır.
    throw new Error("Password too long (max 1024 chars)");
  }

  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(plaintext, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // Max memory — default 32 MB scrypt için yetmez, artırıyoruz.
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

/**
 * Plaintext'i saklanan hash'le karşılaştırır.
 * Timing-safe karşılaştırma yapar (side-channel attack koruması).
 * Hash bozuksa veya eşleşmezse false döner (throw etmez — auth akışında yakalaması kolay olsun).
 */
export function verifyPassword(plaintext: string, storedHash: string): boolean {
  if (typeof plaintext !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const saltHex = parts[4];
  const hashHex = parts[5];

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  if (!saltHex || !hashHex) {
    return false;
  }

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(plaintext, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });

    // Uzunluk farklıysa timingSafeEqual throw eder.
    if (actual.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Basit bir password strength kontrolü.
 * FAZA 1: minimum 8 karakter. Daha katı kural (sayı/büyük harf/özel karakter)
 * yerine uzunluğu tercih ediyoruz — NIST 2017 rehberi böyle öneriyor.
 */
export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string") {
    return { valid: false, reason: "Password must be a string" };
  }
  if (password.length < 8) {
    return { valid: false, reason: "Password must be at least 8 characters" };
  }
  if (password.length > 128) {
    return { valid: false, reason: "Password too long (max 128 chars)" };
  }
  return { valid: true };
}
