/**
 * password.ts unit tests
 *
 * Çalıştır:
 *   pnpm test server/_core/password.test.ts
 * veya:
 *   pnpm test
 */

import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePasswordStrength } from "./password";

describe("password hashing", () => {
  it("hashes and verifies correctly", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("produces different hashes for the same password (random salt)", () => {
    const h1 = hashPassword("same-password");
    const h2 = hashPassword("same-password");
    expect(h1).not.toBe(h2);
    expect(verifyPassword("same-password", h1)).toBe(true);
    expect(verifyPassword("same-password", h2)).toBe(true);
  });

  it("rejects wrong password", () => {
    const hash = hashPassword("correct");
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("Correct", hash)).toBe(false); // case sensitive
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("rejects malformed hash", () => {
    expect(verifyPassword("any", "")).toBe(false);
    expect(verifyPassword("any", "not-a-hash")).toBe(false);
    expect(verifyPassword("any", "bcrypt$10$something")).toBe(false);
    expect(verifyPassword("any", "scrypt$notanumber$8$1$aa$bb")).toBe(false);
  });

  it("throws on empty password", () => {
    expect(() => hashPassword("")).toThrow();
  });

  it("throws on too-long password (DoS protection)", () => {
    expect(() => hashPassword("x".repeat(1025))).toThrow();
  });
});

describe("password strength validation", () => {
  it("rejects too-short passwords", () => {
    expect(validatePasswordStrength("short").valid).toBe(false);
    expect(validatePasswordStrength("1234567").valid).toBe(false);
  });

  it("accepts 8+ character passwords", () => {
    expect(validatePasswordStrength("12345678").valid).toBe(true);
    expect(validatePasswordStrength("correct horse battery staple").valid).toBe(true);
  });

  it("rejects too-long passwords", () => {
    expect(validatePasswordStrength("x".repeat(129)).valid).toBe(false);
  });
});
