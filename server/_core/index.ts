/**
 * Express + tRPC Server Entry
 *
 * FAZA 1 değişiklik — X Filter Pro:
 *  - Manus OAuth route kaydı yoruma alındı (registerOAuthRoutes)
 *  - CORS middleware eklendi (Chrome extension + dashboard için)
 *  - Sağlık kontrol endpoint'i /health eklendi
 *  - Stripe checkout success/cancel sayfaları 8 dilli
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

/**
 * Stripe checkout sonrası gösterilen sayfaların 8 dilli metinleri.
 * Extension'dan URL'e ?lang=xx parametresi gelir.
 */
const CHECKOUT_MESSAGES: Record<string, {
  st: string; sd: string; sb: string;
  ct: string; cd: string; cb: string;
}> = {
  en: { st: "Pro Active!", sd: "Your payment was successful. You can now enjoy all X Filter Pro features with no limits.<br><br>You can close this page — the Pro badge will appear automatically in the extension.", sb: "Close Window", ct: "Payment Cancelled", cd: "No charges were made. You can try upgrading to Pro again from the extension.", cb: "Close Window" },
  tr: { st: "Pro Aktif!", sd: "Ödemen başarıyla alındı. Artık X Filter Pro'nun tüm özelliklerini sınırsız kullanabilirsin.<br><br>Bu sayfayı kapatabilirsin — extension'da Pro rozetin otomatik görünecek.", sb: "Pencereyi Kapat", ct: "Ödeme İptal Edildi", cd: "Herhangi bir ücret alınmadı. Pro'ya geçmek istersen extension'dan tekrar deneyebilirsin.", cb: "Pencereyi Kapat" },
  es: { st: "¡Pro Activo!", sd: "Tu pago se ha recibido correctamente. Ahora puedes disfrutar de todas las funciones de X Filter Pro sin límites.<br><br>Puedes cerrar esta página — la insignia Pro aparecerá automáticamente en la extensión.", sb: "Cerrar Ventana", ct: "Pago Cancelado", cd: "No se ha realizado ningún cargo. Puedes volver a intentar pasar a Pro desde la extensión.", cb: "Cerrar Ventana" },
  pt: { st: "Pro Ativado!", sd: "Seu pagamento foi recebido com sucesso. Agora você pode usar todos os recursos do X Filter Pro sem limites.<br><br>Você pode fechar esta página — o selo Pro aparecerá automaticamente na extensão.", sb: "Fechar Janela", ct: "Pagamento Cancelado", cd: "Nenhuma cobrança foi feita. Você pode tentar fazer o upgrade para Pro novamente a partir da extensão.", cb: "Fechar Janela" },
  de: { st: "Pro Aktiviert!", sd: "Deine Zahlung wurde erfolgreich erhalten. Du kannst jetzt alle Funktionen von X Filter Pro ohne Limit nutzen.<br><br>Du kannst diese Seite schließen — das Pro-Abzeichen erscheint automatisch in der Erweiterung.", sb: "Fenster Schließen", ct: "Zahlung Abgebrochen", cd: "Es wurden keine Gebühren erhoben. Du kannst jederzeit erneut versuchen, auf Pro umzusteigen.", cb: "Fenster Schließen" },
  fr: { st: "Pro Activé !", sd: "Votre paiement a été reçu avec succès. Vous pouvez maintenant profiter de toutes les fonctionnalités X Filter Pro sans limite.<br><br>Vous pouvez fermer cette page — le badge Pro apparaîtra automatiquement dans l'extension.", sb: "Fermer la Fenêtre", ct: "Paiement Annulé", cd: "Aucun frais n'a été prélevé. Vous pouvez réessayer de passer à Pro depuis l'extension.", cb: "Fermer la Fenêtre" },
  ja: { st: "Proが有効になりました！", sd: "お支払いが正常に処理されました。X Filter Proのすべての機能を制限なくお楽しみいただけます。<br><br>このページを閉じても問題ありません — 拡張機能にProバッジが自動的に表示されます。", sb: "ウィンドウを閉じる", ct: "支払いがキャンセルされました", cd: "料金は発生していません。拡張機能から再度Proへのアップグレードをお試しいただけます。", cb: "ウィンドウを閉じる" },
  ar: { st: "تم تفعيل Pro!", sd: "تم استلام دفعتك بنجاح. يمكنك الآن الاستمتاع بجميع ميزات X Filter Pro بدون حدود.<br><br>يمكنك إغلاق هذه الصفحة — ستظهر شارة Pro تلقائيًا في الإضافة.", sb: "إغلاق النافذة", ct: "تم إلغاء الدفع", cd: "لم يتم تحصيل أي رسوم. يمكنك محاولة الترقية إلى Pro مرة أخرى من الإضافة.", cb: "إغلاق النافذة" }
};

function pickLang(q: any): string {
  const l = String(q?.lang || "").toLowerCase().slice(0, 2);
  return (l in CHECKOUT_MESSAGES) ? l : "en";
}

function renderCheckoutPage(opts: {
  title: string; emoji: string; emojiSize: number;
  headline: string; desc: string; btn: string;
  isRTL: boolean; btnColor: string;
}): string {
  const headingSize = opts.emojiSize === 64 ? 42 : 32;
  const btnTextColor = opts.btnColor === "#ffd166" ? "#000" : "#e8e8f0";
  const btnBorder = opts.btnColor === "#ffd166" ? "none" : "1px solid #2a2a40";
  return `<!DOCTYPE html>
<html${opts.isRTL ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a14;color:#e8e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}.c{max-width:420px;padding:40px 30px}.e{font-size:${opts.emojiSize}px;margin-bottom:10px}h1{font-size:${headingSize}px;margin:10px 0 18px;line-height:1.2}p{color:#9a9ab0;line-height:1.7;font-size:15px}.btn{display:inline-block;margin-top:24px;padding:12px 28px;background:${opts.btnColor};color:${btnTextColor};text-decoration:none;border-radius:10px;font-weight:700;border:${btnBorder}}</style>
</head><body><div class="c"><div class="e">${opts.emoji}</div><h1>${opts.headline}</h1><p>${opts.desc}</p><a href="#" onclick="window.close();return false" class="btn">${opts.btn}</a></div></body></html>`;
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

  // Stripe checkout success/cancel landing pages — 8 dilli
  app.get("/checkout-success", (req, res) => {
    const lang = pickLang(req.query);
    const m = CHECKOUT_MESSAGES[lang];
    res.send(renderCheckoutPage({
      title: m.st,
      emoji: "⭐",
      emojiSize: 64,
      headline: m.st,
      desc: m.sd,
      btn: m.sb,
      isRTL: lang === "ar",
      btnColor: "#ffd166",
    }));
  });

  app.get("/checkout-cancel", (req, res) => {
    const lang = pickLang(req.query);
    const m = CHECKOUT_MESSAGES[lang];
    res.send(renderCheckoutPage({
      title: m.ct,
      emoji: "↩",
      emojiSize: 48,
      headline: m.ct,
      desc: m.cd,
      btn: m.cb,
      isRTL: lang === "ar",
      btnColor: "#1e1e30",
    }));
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
