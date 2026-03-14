/**
 * X Filter Pro - Security Middleware
 * 
 * CORS, CSRF, Security Headers ve diğer güvenlik kontrolleri
 */

import { Request, Response, NextFunction } from "express";

/**
 * CORS Middleware - Sadece Chrome extension'dan gelen isteklere izin ver
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  
  // Chrome extension'lar için izin verilen origins
  const allowedOrigins = [
    "chrome-extension://", // Chrome extension
    "moz-extension://", // Firefox extension
    "opera://", // Opera extension
    process.env.FRONTEND_URL, // Frontend (eğer varsa)
  ];

  // Origin kontrolü
  if (origin && allowedOrigins.some((allowed) => origin && allowed && origin.startsWith(allowed))) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Max-Age", "86400"); // 24 hours
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
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
