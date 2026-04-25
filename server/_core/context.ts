import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { verifyJwt } from "./auth";
import { getUserById } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * Extract the JWT from the request.
 *
 * Order of precedence:
 *   1. `Authorization: Bearer <token>` header (extension uses this)
 *   2. `xfp_token` cookie (site uses this for httpOnly cookie flow)
 *
 * Returns null if neither is present.
 */
function extractToken(req: Request): string | null {
  // 1. Authorization header
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  // 2. Cookie fallback (for browser-based flows)
  const cookieHeader = req.headers["cookie"];
  if (typeof cookieHeader === "string") {
    const match = cookieHeader.match(/(?:^|;\s*)xfp_token=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

/**
 * Resolve the authenticated user (or null) for a tRPC request.
 * Authentication is optional at the context layer — protected procedures
 * enforce the user-is-present check via tRPC middleware in `_core/trpc.ts`.
 */
export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;

  const token = extractToken(opts.req);
  if (token) {
    const payload = await verifyJwt(token);
    if (payload?.sub) {
      const userId = Number(payload.sub);
      if (Number.isFinite(userId)) {
        const dbUser = await getUserById(userId);
        if (dbUser) {
          user = dbUser as User;
        }
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
