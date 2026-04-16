/**
 * Environment Variables
 *
 * Bu dosya .env dosyasındaki değerleri okur ve type-safe bir şekilde sunar.
 *
 * .env dosyası tüm gizli bilgileri içerir (API key, DB şifresi, vs.) — ASLA git'e
 * commit edilmemeli. Production'da bu değerler Railway dashboard'dan girilir.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    console.error(`[ENV] Missing required env variable: ${name}`);
  }
  return value ?? "";
}

function optional(value: string | undefined): string {
  return value ?? "";
}

export const ENV = {
  // === ZORUNLU ===

  // JWT imzalama secret'ı — minimum 32 karakter, güçlü random.
  // Üretmek için: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  cookieSecret: required("JWT_SECRET", process.env.JWT_SECRET),

  // MySQL connection string
  databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),

  isProduction: process.env.NODE_ENV === "production",

  // === URLS ===

  // Frontend dashboard URL (Stripe success/cancel ve email linkleri için)
  frontendUrl: optional(process.env.FRONTEND_URL),

  // CORS whitelist — virgülle ayrılmış.
  // Örn: "https://app.xfilterpro.com,chrome-extension://abcdef1234567890"
  // Development için "*" kullanılabilir.
  corsOrigins: optional(process.env.CORS_ORIGINS),

  // === GEMINI AI ===
  // Google AI Studio'dan al: https://aistudio.google.com/app/apikey
  // Free tier: 15 req/dk, 1000 req/gün (gemini-2.5-flash-lite ile)
  // Boş bırakılırsa AI özellikleri çalışmaz, ama auth/Stripe çalışır.
  geminiApiKey: optional(process.env.GEMINI_API_KEY),
  geminiModel: optional(process.env.GEMINI_MODEL) || "gemini-2.5-flash-lite",

  // === STRIPE ===
  stripeSecretKey: optional(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: optional(process.env.STRIPE_WEBHOOK_SECRET),

  // === LEGACY (Manus — DISABLED, kullanılmıyor ama sdk.ts/oauth.ts import etsin diye duruyor) ===
  // Bu değişkenleri Railway'den silebilirsin — yokluk hata vermez, sadece warning.
  appId: optional(process.env.VITE_APP_ID),
  oAuthServerUrl: optional(process.env.OAUTH_SERVER_URL),
  ownerOpenId: optional(process.env.OWNER_OPEN_ID),
  forgeApiUrl: optional(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: optional(process.env.BUILT_IN_FORGE_API_KEY),
};
