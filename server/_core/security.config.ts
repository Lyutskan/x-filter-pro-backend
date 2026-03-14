/**
 * Security Configuration
 * 
 * Güvenlik middleware'lerini Express uygulamasına entegre etmek için
 * Bu dosya server/_core/index.ts içinde kullanılır
 */

import { Express } from "express";
import {
  corsMiddleware,
  securityHeadersMiddleware,
  rateLimitMiddleware,
  sanitizationMiddleware,
  loggingMiddleware,
  errorHandlingMiddleware,
} from "../security.middleware";

/**
 * Tüm güvenlik middleware'lerini uygulamaya ekle
 */
export function setupSecurityMiddleware(app: Express): void {
  // Logging (ilk olarak)
  app.use(loggingMiddleware);

  // CORS
  app.use(corsMiddleware);

  // Security Headers
  app.use(securityHeadersMiddleware);

  // Rate Limiting (API endpoint'leri için)
  app.use("/api/", rateLimitMiddleware(100, 60 * 1000)); // 100 req/min

  // Sanitization
  app.use(sanitizationMiddleware);

  // Error Handling (son olarak)
  app.use(errorHandlingMiddleware);
}

/**
 * Güvenlik kontrolleri özeti
 */
export const SECURITY_FEATURES = {
  cors: "Chrome/Firefox/Opera extension'lardan gelen isteklere izin ver",
  headers: "X-Content-Type-Options, X-Frame-Options, CSP, HSTS vb.",
  rateLimit: "IP başına 100 istek/dakika",
  sanitization: "Input sanitization (XSS koruması)",
  logging: "Güvenlik olayları loglama",
  errorHandling: "Hassas bilgileri expose etmeme",
};
