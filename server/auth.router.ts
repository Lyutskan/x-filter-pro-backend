/**
 * Auth Router — Email/Password
 *
 * FAZA 1 — X Filter Pro
 *
 * tRPC procedure'ları:
 *   - auth.signup (public)   → email + password, yeni kullanıcı oluşturur, session döner
 *   - auth.login  (public)   → email + password doğrular, session döner
 *   - auth.logout (public)   → cookie'yi siler (mevcut kodda vardı, buraya taşındı)
 *   - auth.me     (public)   → mevcut user'ı döner (null olabilir)
 *
 * Response formatı:
 *   {
 *     token: string,   // Bearer token (extension için)
 *     user: { id, email, name, isPro, role, authProvider }
 *   }
 *
 * Dashboard için cookie ayrıca set edilir (HttpOnly, Secure, SameSite=None).
 * Extension için tokenı localStorage/chrome.storage'a koyar.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { publicProcedure, router } from "./_core/trpc";
import { signSession } from "./_core/session";
import { hashPassword, verifyPassword, validatePasswordStrength } from "./_core/password";
import { getSessionCookieOptions } from "./_core/cookies";
import * as db from "./db";

// Public safe user shape — password hash ve internal field'lar çıkarıldı.
type PublicUser = {
  id: number;
  email: string;
  name: string | null;
  isPro: boolean;
  role: "user" | "admin";
  authProvider: "email" | "google" | "manus";
};

function toPublicUser(user: {
  id: number;
  email: string;
  name: string | null;
  isPro: boolean;
  role: "user" | "admin";
  authProvider: "email" | "google" | "manus";
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isPro: user.isPro,
    role: user.role,
    authProvider: user.authProvider,
  };
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email too short")
  .max(320, "Email too long")
  .email("Invalid email format");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long (max 128)");

const nameSchema = z.string().trim().min(1).max(100).optional();

export const authRouter = router({
  /**
   * Yeni hesap oluştur.
   */
  signup: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: nameSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Extra strength kontrolü (Zod min 8 zaten kontrol ediyor ama ileride kuralları buraya koyarız)
      const strength = validatePasswordStrength(input.password);
      if (!strength.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: strength.reason || "Weak password" });
      }

      // Email zaten var mı?
      const existing = await db.getUserByEmail(input.email);
      if (existing) {
        // Güvenlik notu: ENUMeration leak'i önlemek için aynı mesajı login ve signup'ta verebiliriz.
        // Ama UX için şu aşamada net mesaj veriyoruz. İleride rate-limit'le koruyacağız.
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      const passwordHash = hashPassword(input.password);

      let newUser;
      try {
        newUser = await db.createEmailUser({
          email: input.email,
          name: input.name ?? null,
          passwordHash,
        });
      } catch (err) {
        console.error("[auth.signup] createEmailUser failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account",
        });
      }

      // Default subscription oluştur (free plan)
      try {
        await db.getOrCreateSubscription(newUser.id);
      } catch (err) {
        // Subscription oluşturulamadıysa log'la ama signup'ı başarılı say — sonraki istek tekrar dener.
        console.error("[auth.signup] getOrCreateSubscription failed:", err);
      }

      // Session token
      const token = await signSession({
        uid: newUser.id,
        email: newUser.email,
        provider: "email",
      });

      // Dashboard kullanımı için cookie de set et
      try {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      } catch (err) {
        // Cookie set edilemediyse (test env vs) token response'ta yine dönüyor, devam.
        console.warn("[auth.signup] cookie set failed:", err);
      }

      return {
        token,
        user: toPublicUser(newUser),
      };
    }),

  /**
   * Email + password ile giriş.
   */
  login: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        password: z.string().min(1).max(1024), // login sırasında strength kuralı yok, sadece uzunluk
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserByEmail(input.email);

      // Sabit-zamanlı hata mesajı: email yok + password yanlış aynı mesaj
      const invalidMsg = "Invalid email or password";

      if (!user) {
        // Timing attack koruması: fake bir hash ile verify çalıştır ki yanıt süresi benzer olsun
        verifyPassword(
          input.password,
          "scrypt$16384$8$1$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
        );
        throw new TRPCError({ code: "UNAUTHORIZED", message: invalidMsg });
      }

      if (user.authProvider !== "email" || !user.passwordHash) {
        // OAuth kullanıcısı şifreyle giriş denedi
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This account does not use password login",
        });
      }

      const ok = verifyPassword(input.password, user.passwordHash);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: invalidMsg });
      }

      // Subscription'ı hazır tut
      try {
        await db.getOrCreateSubscription(user.id);
      } catch (err) {
        console.error("[auth.login] getOrCreateSubscription failed:", err);
      }

      const token = await signSession({
        uid: user.id,
        email: user.email,
        provider: "email",
      });

      try {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      } catch (err) {
        console.warn("[auth.login] cookie set failed:", err);
      }

      return {
        token,
        user: toPublicUser(user),
      };
    }),

  /**
   * Çıkış — cookie sil. Bearer token tarafında ise istemci kendi token'ını atar.
   * (Gerçek "revocation" için blacklist tablosu lazım, FAZA 1 kapsamında değil.)
   */
  logout: publicProcedure.mutation(({ ctx }) => {
    try {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    } catch (err) {
      console.warn("[auth.logout] clearCookie failed:", err);
    }
    return { success: true } as const;
  }),

  /**
   * Mevcut oturumdaki user. Yoksa null döner — frontend bunu "logged out" olarak yorumlar.
   */
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return null;
    return toPublicUser(ctx.user);
  }),
});

export type AuthRouter = typeof authRouter;
