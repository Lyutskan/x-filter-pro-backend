# Integration Guide - Webhook ve Scheduler Entegrasyonu

Bu dokümantasyon, Stripe webhook'larını ve scheduler'ı `server/_core/index.ts` dosyasına entegre etmek için gereken adımları açıklar.

## 1. Webhook Entegrasyonu

### Adım 1: server/_core/index.ts dosyasını açın

```bash
nano server/_core/index.ts
```

### Adım 2: Stripe router'ı import edin

Dosyanın üst kısmına aşağıdaki import'ı ekleyin:

```typescript
import { createStripeRouter } from "../stripe.routes";
```

### Adım 3: Express app'e webhook route'unu ekleyin

`app.use("/api/trpc", ...)` satırından ÖNCE aşağıdaki kodu ekleyin:

```typescript
// Stripe webhook endpoint
// KRITIK: express.raw() middleware'i express.json()'dan ÖNCE çalışmalı
app.use(
  "/api/stripe",
  express.raw({ type: "application/json" }),
  createStripeRouter()
);
```

**Önemli:** Webhook signature doğrulaması için `express.raw()` middleware'i `express.json()`'dan ÖNCE çalışmalıdır.

### Adım 4: Test edin

```bash
pnpm dev
```

Webhook endpoint'i şu adreste çalışacaktır:
```
POST /api/stripe/webhook
```

---

## 2. Scheduler Entegrasyonu

### Adım 1: Scheduler'ı import edin

`server/_core/index.ts` dosyasının üst kısmına aşağıdaki import'ı ekleyin:

```typescript
import { initializeScheduler, stopScheduler, getSchedulerStatus } from "../scheduler.service";
```

### Adım 2: Server başladığında scheduler'ı başlatın

Server başlama kodunun sonuna (örneğin `console.log("Server running...")` satırından sonra) aşağıdaki kodu ekleyin:

```typescript
// Initialize scheduler for background jobs
initializeScheduler().catch((error) => {
  console.error("[Server] Failed to initialize scheduler:", error);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down gracefully...");
  stopScheduler();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[Server] SIGINT received, shutting down gracefully...");
  stopScheduler();
  process.exit(0);
});
```

### Adım 3: Scheduler status endpoint'i (opsiyonel)

Scheduler'ın durumunu kontrol etmek için tRPC endpoint'i ekleyebilirsiniz:

```typescript
// server/routers.ts dosyasında
system: router({
  getSchedulerStatus: publicProcedure.query(async () => {
    const { getSchedulerStatus } = await import("../scheduler.service");
    return getSchedulerStatus();
  }),
  // ... diğer endpoint'ler
}),
```

---

## 3. SendGrid Entegrasyonu

### Adım 1: SendGrid API Key'i ayarlayın

Environment variable'ı ayarlayın:

```bash
export SENDGRID_API_KEY="SG.your_api_key_here"
export SENDGRID_FROM_EMAIL="noreply@xfilterpro.com"
```

Veya `.env` dosyasına ekleyin (production'da Settings → Secrets'ten ayarlayın):

```
SENDGRID_API_KEY=SG.your_api_key_here
SENDGRID_FROM_EMAIL=noreply@xfilterpro.com
```

### Adım 2: Test edin

```bash
pnpm dev
```

Email gönderme testi:

```typescript
import { generateDailySummaryEmail, sendEmail } from "./email.service";

const template = await generateDailySummaryEmail("Test User", {
  totalHidden: 42,
  totalSeen: 100,
  totalTimeSaved: 3600,
  topAccounts: [{ account: "@testaccount", count: 5 }],
});

const result = await sendEmail("test@example.com", template);
console.log(result);
```

---

## 4. Scheduled Jobs

### Günlük Email (08:00 UTC)

Her gün saat 08:00 UTC'de tüm kullanıcılara günlük özet emaili gönderilir.

### Snooze Temizleme (Saatlik)

Her saat süresi dolmuş snooze'lar temizlenir.

### Eski İstatistikler Temizleme (Her 6 saat)

90 günden eski istatistikler temizlenir.

---

## 5. Webhook Events

### checkout.session.completed

Kullanıcı başarılı ödeme yaptığında:
- Subscription tablosunda `isPro = true` ayarlanır
- Renewal date hesaplanır
- User tablosunda `isPro = true` ayarlanır

### customer.subscription.updated

Subscription durumu değiştiğinde:
- Subscription status güncellenir
- Pro/Free durumu senkronize edilir

### customer.subscription.deleted

Subscription iptal edildiğinde:
- Kullanıcı Free plana indirilir
- Limits sıfırlanır

### invoice.paid

Fatura ödendiğinde:
- Ödeme başarılı olarak kaydedilir
- (Opsiyonel) Ödeme bildirim emaili gönderilebilir

---

## 6. Environment Variables

Production deployment'ta şu environment variable'ları ayarlayın:

```
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...

# SendGrid
SENDGRID_API_KEY=SG.your_api_key_here
SENDGRID_FROM_EMAIL=noreply@xfilterpro.com

# Database
DATABASE_URL=mysql://user:pass@host/db

# OAuth
VITE_APP_ID=your_app_id
OAUTH_SERVER_URL=https://api.manus.im
JWT_SECRET=your_jwt_secret
```

---

## 7. Testing

### Webhook Test (Stripe CLI)

```bash
# Stripe CLI'yi yükle
brew install stripe/stripe-cli/stripe

# Webhook'ları forward et
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Test event gönder
stripe trigger payment_intent.succeeded
```

### Email Test

```bash
curl -X POST http://localhost:3000/api/trpc/xfilter.sendDailySummaryEmail \
  -H "Content-Type: application/json" \
  -d '{"userId": 1}'
```

---

## 8. Troubleshooting

### Webhook'lar alınmıyor

1. Stripe Dashboard → Developers → Webhooks'da endpoint'i kontrol edin
2. Event delivery logs'ı kontrol edin
3. Webhook secret'ı doğru ayarlandığını kontrol edin

### Email'ler gönderilmiyor

1. SENDGRID_API_KEY ayarlandığını kontrol edin
2. SendGrid dashboard'da API key'in aktif olduğunu kontrol edin
3. Logs'ta error mesajlarını kontrol edin

### Scheduler çalışmıyor

1. Server logs'ında "[Scheduler] Initializing scheduled jobs..." mesajını kontrol edin
2. Node process'in çalıştığını kontrol edin
3. Cron expression'ı doğru ayarlandığını kontrol edin

---

## 9. Sonraki Adımlar

- [ ] Webhook'ları production'a deploy et
- [ ] SendGrid API key'i production'a ayarla
- [ ] Scheduler'ı production'da test et
- [ ] Email template'lerini özelleştir
- [ ] Monitoring ve alerting kur
- [ ] Webhook retry logic'i ekle
- [ ] Email unsubscribe mekanizması ekle

---

**Son Güncelleme:** 10 Mart 2026
