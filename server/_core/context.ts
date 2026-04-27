import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { verifyJwt } from "./auth";
import { getActiveAuthSession, getUserById, touchAuthSession } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User & { sessionId?: string }) | null;
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
 *
 * Auth flow:
 *   1. Extract JWT
 *   2. Verify signature + expiry
 *   3. Check that the session referenced by `sid` is still active (not revoked)
 *   4. Load the user row
 *   5. Touch lastSeenAt for the session (fire-and-forget)
 *
 * If any step fails the user is treated as logged out and protected
 * procedures will reject with UNAUTHORIZED.
 */
export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: TrpcContext["user"] = null;

  const token = extractToken(opts.req);
  if (token) {
    const payload = await verifyJwt(token);
    if (payload?.sub && payload.sid) {
      // Check session is still active in DB (revocation check)
      const session = await getActiveAuthSession(payload.sid);
      if (session) {
        const userId = Number(payload.sub);
        if (Number.isFinite(userId) && session.userId === userId) {
          const dbUser = await getUserById(userId);
          if (dbUser) {
            user = { ...(dbUser as User), sessionId: payload.sid };
            // Fire-and-forget; don't block the request
            void touchAuthSession(payload.sid);
          }
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
