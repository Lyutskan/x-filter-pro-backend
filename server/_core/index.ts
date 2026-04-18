/**
 * Express + tRPC Server Entry
 *
 * FAZA 1 değişiklik — X Filter Pro:
 *  - Manus OAuth route kaydı yoruma alındı (registerOAuthRoutes)
 *  - CORS middleware eklendi (Chrome extension + dashboard için)
 *  - Sağlık kontrol endpoint'i /health eklendi
 */

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// import { registerOAuthRoutes } from "./oauth"; // DISABLED in FAZA 1
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createStripeRouter } from "../stripe.routes";
import { initializeScheduler, stopScheduler } from "../scheduler.service";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Basit, bağımlılıksız CORS middleware.
 * Virgülle ayrılmış CORS_ORIGINS env değişkeninden whitelist okur.
 * Chrome extension için "chrome-extension://<id>" formatında whitelist lazım.
 *
 * CORS_ORIGINS="" (boş) veya set edilmemiş ise — tüm origin'ler reddedilir.
 * Development için "CORS_ORIGINS=*" kullanılabilir (production'da ASLA).
 */
function corsMiddleware(): express.RequestHandler {
  const rawOrigins = ENV.corsOrigins;
  const allowAll = rawOrigins === "*";
  const whitelist = allowAll
    ? []
    : rawOrigins
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origin) {
      if (allowAll) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      } else if (whitelist.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
      res.setHeader("Vary", "Origin");
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Requested-With,Cookie"
    );
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // CORS — tRPC ve stripe webhook'undan ÖNCE
  app.use(corsMiddleware());

  // Stripe webhook — raw body gerektirir, express.json()'dan ÖNCE olmalı
  app.use(
    "/api/stripe",
    express.raw({ type: "application/json" }),
    createStripeRouter()
  );

  // Body parser — dosya uploadları için 50mb
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Stripe checkout success/cancel landing pages
  app.get("/checkout-success", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Success</title>
<style>body{font-family:system-ui;background:#0a0a14;color:#e8e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.c{max-width:400px;padding:40px}h1{font-size:48px;margin:0 0 20px}p{color:#66668a;line-height:1.6}.btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#ffd166;color:#000;text-decoration:none;border-radius:8px;font-weight:700}</style>
</head><body><div class="c"><div style="font-size:64px">⭐</div><h1>Pro Aktif!</h1><p>Ödemen başarıyla alındı. Artık X Filter Pro'nun tüm özelliklerini sınırsız kullanabilirsin.<br><br>Bu sayfayı kapatabilirsin — extension'da Pro rozetin otomatik görünecek.</p><a href="#" onclick="window.close();return false" class="btn">Pencereyi Kapat</a></div></body></html>`);
  });

  app.get("/checkout-cancel", (_req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Cancelled</title>
<style>body{font-family:system-ui;background:#0a0a14;color:#e8e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.c{max-width:400px;padding:40px}h1{font-size:36px;margin:0 0 20px}p{color:#66668a;line-height:1.6}.btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#1e1e30;color:#e8e8f0;text-decoration:none;border-radius:8px;border:1px solid #2a2a40}</style>
</head><body><div class="c"><div style="font-size:48px">↩</div><h1>Ödeme İptal Edildi</h1><p>Herhangi bir ücret alınmadı. Pro'ya geçmek istersen extension'dan tekrar deneyebilirsin.</p><a href="#" onclick="window.close();return false" class="btn">Pencereyi Kapat</a></div></body></html>`);
  });
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "x-filter-pro-backend",
    });
  });

  // DISABLED IN FAZA 1: Manus OAuth callback
  // Ileride Google OAuth eklendiginde ayni pattern'i kullanacagiz.
  // registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Static / Vite
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[Server] Running on http://localhost:${port}/`);
    console.log(`[Server] Health check: http://localhost:${port}/health`);
    console.log(`[Server] tRPC endpoint: http://localhost:${port}/api/trpc`);
  });

  try {
    await initializeScheduler();
    console.log("[Server] Scheduler initialized successfully");
  } catch (error) {
    console.error("[Server] Failed to initialize scheduler:", error);
  }

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    stopScheduler();
    server.close(() => {
      console.log("[Server] Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(err => {
  console.error("[Server] Fatal error on startup:", err);
  process.exit(1);
});
