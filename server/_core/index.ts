import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createStripeRouter } from "../stripe.routes";
import { initializeScheduler, stopScheduler } from "../scheduler.service";
import { corsMiddleware } from "../security.middleware";

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

async function startServer() {
  const app = express();
  const server = createServer(app);

  // CORS — must be first so OPTIONS preflight gets handled before
  // any other middleware (especially body parsers and auth).
  app.use(corsMiddleware);

  // Health check endpoint — used by Railway, Cloudflare, monitoring tools.
  // Lives outside /api/* so it doesn't go through tRPC; super-fast, no DB hit.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "x-filter-pro-backend",
    });
  });

  // ── Stripe checkout return pages (8 languages) ───────────────────
  // These are landing pages the user sees AFTER returning from Stripe Checkout.
  // We render inline HTML rather than redirecting to the marketing site so the
  // success/cancel state is unambiguous and works even if the marketing site is
  // briefly unavailable.

  type LangKey = "en" | "tr" | "es" | "pt" | "de" | "fr" | "ja" | "ar";
  const SUPPORTED_LANGS: LangKey[] = ["en", "tr", "es", "pt", "de", "fr", "ja", "ar"];

  const CHECKOUT_MESSAGES: Record<LangKey, {
    st: string; sd: string; sb: string; ct: string; cd: string; cb: string;
  }> = {
    en: { st: "Payment successful 🎉", sd: "Welcome to X Filter Pro! Pro features are unlocking now.", sb: "Open my account",
          ct: "Checkout cancelled", cd: "No charge was made. You can try again anytime.", cb: "Back to pricing" },
    tr: { st: "Ödeme başarılı 🎉", sd: "X Filter Pro'ya hoş geldin! Pro özellikler birazdan aktif olacak.", sb: "Hesabıma git",
          ct: "Ödeme iptal edildi", cd: "Hiçbir ücret alınmadı. Dilediğin zaman tekrar deneyebilirsin.", cb: "Fiyatlara dön" },
    es: { st: "Pago exitoso 🎉", sd: "¡Bienvenido a X Filter Pro! Las funciones Pro se están activando.", sb: "Abrir mi cuenta",
          ct: "Compra cancelada", cd: "No se realizó ningún cargo. Puedes intentarlo de nuevo cuando quieras.", cb: "Volver a precios" },
    pt: { st: "Pagamento concluído 🎉", sd: "Bem-vindo ao X Filter Pro! Os recursos Pro estão sendo ativados.", sb: "Abrir minha conta",
          ct: "Pagamento cancelado", cd: "Nenhuma cobrança foi feita. Você pode tentar novamente a qualquer momento.", cb: "Voltar aos preços" },
    de: { st: "Zahlung erfolgreich 🎉", sd: "Willkommen bei X Filter Pro! Pro-Funktionen werden jetzt freigeschaltet.", sb: "Mein Konto öffnen",
          ct: "Bezahlung abgebrochen", cd: "Es wurde nichts abgebucht. Du kannst es jederzeit erneut versuchen.", cb: "Zurück zur Preisseite" },
    fr: { st: "Paiement réussi 🎉", sd: "Bienvenue sur X Filter Pro ! Les fonctionnalités Pro s'activent maintenant.", sb: "Ouvrir mon compte",
          ct: "Paiement annulé", cd: "Aucun montant n'a été débité. Tu peux réessayer à tout moment.", cb: "Retour aux tarifs" },
    ja: { st: "お支払い完了 🎉", sd: "X Filter Pro へようこそ。Pro機能が間もなく有効になります。", sb: "アカウントを開く",
          ct: "お支払いはキャンセルされました", cd: "請求は行われていません。いつでもまたお試しいただけます。", cb: "料金ページに戻る" },
    ar: { st: "تمت عملية الدفع بنجاح 🎉", sd: "مرحباً بك في X Filter Pro! ميزات Pro قيد التفعيل الآن.", sb: "افتح حسابي",
          ct: "تم إلغاء عملية الدفع", cd: "لم يتم اقتطاع أي مبلغ. يمكنك المحاولة مرة أخرى في أي وقت.", cb: "العودة إلى الأسعار" },
  };

  function pickLang(req: express.Request): LangKey {
    const fromQuery = (req.query.lang as string | undefined)?.toLowerCase().slice(0, 2);
    if (fromQuery && (SUPPORTED_LANGS as string[]).includes(fromQuery)) {
      return fromQuery as LangKey;
    }
    const acceptLang = (req.headers["accept-language"] as string | undefined)?.toLowerCase();
    if (acceptLang) {
      for (const lang of SUPPORTED_LANGS) {
        if (acceptLang.includes(lang)) return lang;
      }
    }
    return "en";
  }

  function renderCheckoutPage(
    kind: "success" | "cancel",
    lang: LangKey,
  ): string {
    const m = CHECKOUT_MESSAGES[lang];
    const isSuccess = kind === "success";
    const accent = isSuccess ? "#ffd166" : "#6ee7f7";
    const cardBg = isSuccess ? "rgba(255, 209, 102, 0.05)" : "#1e1e30";
    const dir = lang === "ar" ? "rtl" : "ltr";
    const title = isSuccess ? m.st : m.ct;
    const desc = isSuccess ? m.sd : m.cd;
    const btnLabel = isSuccess ? m.sb : m.cb;
    const btnHref = isSuccess ? "https://xfilterpro.com/account" : "https://xfilterpro.com/pricing";

    return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { margin:0; min-height:100vh; background:#0a0a14; color:#e8e8f0;
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { max-width:440px; width:100%; background:${cardBg};
    border:1px solid ${isSuccess ? "rgba(255,209,102,0.3)" : "#2a2a40"};
    border-radius:16px; padding:40px 32px; text-align:center; }
  h1 { color:${accent}; font-size:28px; margin:0 0 12px; line-height:1.2; }
  p  { color:#aaa; font-size:15px; line-height:1.6; margin:0 0 28px; }
  a.btn { display:inline-block; background:${accent}; color:#000; text-decoration:none;
    padding:12px 28px; border-radius:10px; font-weight:700; font-size:14px; }
  a.btn:hover { transform:translateY(-1px); }
</style></head>
<body><div class="card">
<h1>${title}</h1>
<p>${desc}</p>
<a class="btn" href="${btnHref}">${btnLabel}</a>
</div></body></html>`;
  }

  app.get("/checkout-success", (req, res) => {
    const lang = pickLang(req);
    res.type("html").send(renderCheckoutPage("success", lang));
  });

  app.get("/checkout-cancel", (req, res) => {
    const lang = pickLang(req);
    res.type("html").send(renderCheckoutPage("cancel", lang));
  });

  // ⚠️ ORDER MATTERS — Stripe webhook MUST come BEFORE express.json().
  // Stripe verifies the signature using the raw request body. If express.json()
  // runs first it parses the body into a JS object, and the signature check
  // breaks with: "Webhook payload must be provided as a string or a Buffer".
  app.use(
    "/api/stripe",
    express.raw({ type: "application/json" }),
    createStripeRouter()
  );

  // Body parsers for everything ELSE (tRPC, auth, etc.)
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
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
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Initialize scheduler for background jobs (daily emails, cleanup, etc.)
  try {
    await initializeScheduler();
    console.log("[Server] Scheduler initialized successfully");
  } catch (error) {
    console.error("[Server] Failed to initialize scheduler:", error);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM received, shutting down gracefully...");
    stopScheduler();
    server.close(() => {
      console.log("[Server] Server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("[Server] SIGINT received, shutting down gracefully...");
    stopScheduler();
    server.close(() => {
      console.log("[Server] Server closed");
      process.exit(0);
    });
  });
}

startServer().catch(console.error);
