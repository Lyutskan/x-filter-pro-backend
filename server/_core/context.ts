/**
 * tRPC Context
 *
 * FAZA 1 değişiklik — X Filter Pro
 *
 * Manus SDK'ya bağımlılığı kaldırdık. Artık iki token kaynağını da kabul ediyoruz:
 *   1. Cookie (web dashboard için, HttpOnly)
 *   2. Authorization: Bearer <token> (Chrome extension için)
 *
 * Her ikisi de aynı JWT formatını kullanır (_core/session.ts).
 * Bearer header öncelikli — eğer varsa cookie'ye bakmıyoruz.
 *
 * Fail modu: token yoksa veya bozuksa user=null, throw etmiyoruz.
 * Protected procedure'lar _core/trpc.ts'te user=null'ı 401'e çevirir.
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as dbMod from "../db";
import { COOKIE_NAME } from "@shared/const";
import { extractBearerToken, extractCookie, verifySession } from "./session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // 1) Bearer header önce (extension)
    let token = extractBearerToken(opts.req.headers.authorization);

    // 2) Yoksa cookie (web dashboard)
    if (!token) {
      token = extractCookie(opts.req.headers.cookie, COOKIE_NAME);
    }

    if (token) {
      const session = await verifySession(token);
      if (session) {
        // Token geçerli — user'ı DB'den tazele (Pro status değişmiş olabilir).
        const freshUser = await dbMod.getUserById(session.uid);
        if (freshUser) {
          user = freshUser;
          // lastSignedIn'i güncellemek için fire-and-forget (auth path'i yavaşlatmayalım).
          dbMod.touchLastSignedIn(freshUser.id).catch(() => {
            /* sessizce yut — critical değil */
          });
        }
      }
    }
  } catch (error) {
    // Auth hatası public procedure'ları bloklamasın.
    console.warn("[Context] Auth attempt failed:", error instanceof Error ? error.message : error);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
