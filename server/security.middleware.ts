/**
 * X Filter Pro - Security Middleware
 * 
 * CORS, CSRF, Security Headers ve diğer güvenlik kontrolleri
 */

import { Request, Response, NextFunction } from "express";

/**
 * CORS Middleware
 *
 * Allowed origins:
 *   - Chrome / Firefox / Opera / Edge extensions (any extension that loads this backend)
 *   - https://xfilterpro.com (production site)
 *   - https://www.xfilterpro.com
 *   - localhost on common dev ports (3000, 5173, 4173, 8080)
 *   - process.env.FRONTEND_URL (custom override if set)
 *
 * For tRPC + browser fetch with `Authorization: Bearer ...`, both
 * preflight (OPTIONS) and the actual request must reflect the origin
 * back. We DO NOT use a wildcard `*` because we send credentials.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;

  // Static prefixes — any URL starting with these is allowed.
  const allowedPrefixes = [
    "chrome-extension://",
    "moz-extension://",
    "edge-extension://",
    "opera-extension://",
  ];

  // Exact-match allow-list. Add new origins here as we ship.
  const allowedOrigins = new Set<string>([
    "https://xfilterpro.com",
    "https://www.xfilterpro.com",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ]);
  if (process.env.FRONTEND_URL) {
    allowedOrigins.add(process.env.FRONTEND_URL);
  }

  const isAllowed =
    !!origin &&
    (allowedPrefixes.some((p) => origin.startsWith(p)) || allowedOrigins.has(origin));

  if (isAllowed && origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin"); // tell caches the response varies by Origin
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-trpc-source",
    );
    res.header("Access-Control-Max-Age", "86400");
  }

  // Always answer OPTIONS preflight, even from disallowed origins, so the
  // browser sees a clear response (the missing CORS headers will then make
  // it block the actual request — that's the correct behaviour).
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

/**
 * Security Headers Middleware
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // X-Content-Type-Options: MIME type sniffing'i önle
  res.header("X-Content-Type-Options", "nosniff");

  // X-Frame-Options: Clickjacking'i önle
  res.header("X-Frame-Options", "DENY");

  // X-XSS-Protection: XSS saldırılarına karşı koruma
  res.header("X-XSS-Protection", "1; mode=block");

  // Strict-Transport-Security: HTTPS kullanımını zorunlu kıl
  res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Content-Security-Policy: İçerik güvenliği
  res.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
  );

  // Referrer-Policy: Referrer bilgisini sınırla
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions-Policy: Tarayıcı özelliklerini sınırla
  res.header(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
  );

  next();
}

/**
 * Rate Limiting Middleware
 * IP başına istek sayısını sınırla
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimitMiddleware(
  maxRequests: number = 100,
  windowMs: number = 60 * 1000 // 1 minute
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    let record = requestCounts.get(ip);

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + windowMs };
      requestCounts.set(ip, record);
    }

    record.count++;

    res.header("X-RateLimit-Limit", String(maxRequests));
    res.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - record.count)));
    res.header("X-RateLimit-Reset", String(record.resetTime));

    if (record.count > maxRequests) {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    } else {
      next();
    }
  };
}

/**
 * Auth-specific rate limiter — much stricter than general API rate limit.
 *
 * Why a separate limiter:
 *   - Brute-force protection on login/signup needs aggressive throttling
 *   - 5 attempts / 15 min is the OWASP recommendation for auth endpoints
 *   - Keyed by IP only (not email) — so an attacker who tries many emails
 *     from the same IP still gets throttled
 *
 * Limits:
 *   - 5 requests per 15-minute window per IP
 *   - Returns 429 with `retryAfter` (seconds) on overflow
 *   - Successful requests still count toward the limit (simpler & safer)
 *
 * Memory note: Counters live in-process; they reset on server restart and
 * aren't shared between Railway replicas. For a single-replica hobby setup
 * this is fine. If we ever scale horizontally we should move to Redis.
 */
const authAttempts = new Map<string, { count: number; resetTime: number }>();

export function authRateLimitMiddleware() {
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  return (req: Request, res: Response, next: NextFunction) => {
    // Only apply to auth.signup, auth.login, auth.changePassword.
    // tRPC routes auth procedures under /api/trpc/auth.<procedure>.
    const path = req.path;
    const isAuth =
      path.startsWith("/auth.signup") ||
      path.startsWith("/auth.login") ||
      path.startsWith("/auth.changePassword");
    if (!isAuth) return next();

    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();

    let record = authAttempts.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + WINDOW_MS };
      authAttempts.set(ip, record);
    }
    record.count++;

    res.header("X-RateLimit-Limit", String(MAX_ATTEMPTS));
    res.header("X-RateLimit-Remaining", String(Math.max(0, MAX_ATTEMPTS - record.count)));
    res.header("X-RateLimit-Reset", String(record.resetTime));

    if (record.count > MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.status(429).json({
        error: {
          json: {
            message: `Too many auth attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
            code: -32600,
            data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
          },
        },
        retryAfter,
      });
      return;
    }

    next();
  };
}

/**
 * Periodic cleanup of stale rate-limit entries to prevent memory bloat.
 * Called once at startup; the timer survives for the process lifetime.
 */
export function startRateLimitCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requestCounts.entries()) {
      if (now > record.resetTime) requestCounts.delete(key);
    }
    for (const [key, record] of authAttempts.entries()) {
      if (now > record.resetTime) authAttempts.delete(key);
    }
  }, 5 * 60 * 1000); // every 5 min
}

/**
 * API Key Validation Middleware
 * tRPC için gerekli değil (auth context'te yapılıyor), ama REST API'ler için
 */
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }

  next();
}

/**
 * Input Sanitization Middleware
 */
export function sanitizationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Query parametrelerini sanitize et
  if (req.query) {
    Object.keys(req.query).forEach((key) => {
      const value = req.query[key];
      if (typeof value === "string") {
        // Tehlikeli karakterleri kaldır
        req.query[key] = value
          .replace(/[<>\"'`]/g, "")
          .substring(0, 1000); // Max 1000 karakter
      }
    });
  }

  // Body'yi sanitize et (JSON)
  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body);
  }

  next();
}

/**
 * Recursive object sanitization
 */
function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];

      if (typeof value === "string") {
        obj[key] = value
          .replace(/[<>\"'`]/g, "")
          .substring(0, 5000);
      } else if (typeof value === "object" && value !== null) {
        sanitizeObject(value);
      }
    }
  }
}

/**
 * Request Logging Middleware
 */
export function loggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const log = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    };

    // Sadece hata ve yavaş istekleri logla
    if (res.statusCode >= 400 || duration > 1000) {
      console.log("[Security Log]", JSON.stringify(log));
    }
  });

  next();
}

/**
 * Error Handling Middleware
 */
export function errorHandlingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("[Error]", {
    timestamp: new Date().toISOString(),
    message: err.message,
    path: req.path,
    method: req.method,
  });

  // Hassas bilgileri expose etme
  const statusCode = (err as any).statusCode || 500;
  const message = statusCode === 500 ? "Internal server error" : err.message;

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}
