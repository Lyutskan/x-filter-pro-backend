# X Filter Pro Backend - API Dokümantasyonu

## Genel Bilgi

**Base URL:** `https://your-domain.com/api`

**Authentication:** Manus OAuth (JWT token via session cookie)

**Response Format:** JSON (tRPC)

---

## tRPC Endpoints

### Auth Endpoints

#### `auth.me`
Mevcut kullanıcının bilgilerini al

```typescript
// Query
trpc.auth.me.useQuery()

// Response
{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}
```

#### `auth.logout`
Kullanıcıyı çıkış yap

```typescript
// Mutation
trpc.auth.logout.useMutation()

// Response
{ success: true }
```

---

### X Filter Pro Endpoints

#### `xfilter.hideTweet`
Tweet'i gizle (seen tweets'e ekle)

```typescript
// Mutation
trpc.xfilter.hideTweet.useMutation()

// Input
{
  tweetId: string;
  reason?: "keyword" | "account" | "link" | "ad" | "other";
  metadata?: Record<string, unknown>;
}

// Response
{ success: true; tweetId: string }
```

#### `xfilter.getSeenTweets`
Gizlenen tweet'leri al

```typescript
// Query
trpc.xfilter.getSeenTweets.useQuery({
  limit: 50;
  offset: 0;
  startDate?: Date;
  endDate?: Date;
})

// Response
{
  tweets: Array<{
    id: string;
    tweetId: string;
    reason: string;
    hiddenAt: Date;
    snoozeUntil: Date | null;
  }>;
  total: number;
}
```

#### `xfilter.snoozeTweet`
Tweet'i 24 saat snooze et

```typescript
// Mutation
trpc.xfilter.snoozeTweet.useMutation()

// Input
{ tweetId: string }

// Response
{ success: true; snoozeUntil: Date }
```

#### `xfilter.unsnoozeAllTweets`
Tüm snooze'ları kaldır

```typescript
// Mutation
trpc.xfilter.unsnoozeAllTweets.useMutation()

// Response
{ success: true; count: number }
```

---

### Filtreleme Endpoints

#### `xfilter.addFilterRule`
Yeni filtreleme kuralı ekle

```typescript
// Mutation
trpc.xfilter.addFilterRule.useMutation()

// Input
{
  type: "keyword" | "account" | "link" | "follower_count" | "engagement" | "language" | "media_type" | "reply_ratio";
  value: string;
  enabled?: boolean;
}

// Response
{ success: true; ruleId: number }
```

#### `xfilter.getFilterRules`
Tüm filtreleme kurallarını al

```typescript
// Query
trpc.xfilter.getFilterRules.useQuery()

// Response
Array<{
  id: number;
  type: string;
  value: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}>
```

#### `xfilter.updateFilterRule`
Filtreleme kuralını güncelle

```typescript
// Mutation
trpc.xfilter.updateFilterRule.useMutation()

// Input
{
  ruleId: number;
  enabled?: boolean;
  value?: string;
}

// Response
{ success: true }
```

#### `xfilter.deleteFilterRule`
Filtreleme kuralını sil

```typescript
// Mutation
trpc.xfilter.deleteFilterRule.useMutation()

// Input
{ ruleId: number }

// Response
{ success: true }
```

---

### Muted Accounts

#### `xfilter.muteAccount`
Hesabı sessize al

```typescript
// Mutation
trpc.xfilter.muteAccount.useMutation()

// Input
{
  accountHandle: string;
  muteUntil?: Date;
}

// Response
{ success: true; accountId: number }
```

#### `xfilter.getMutedAccounts`
Sessize alınan hesapları al

```typescript
// Query
trpc.xfilter.getMutedAccounts.useQuery()

// Response
Array<{
  id: number;
  accountHandle: string;
  muteUntil: Date | null;
  mutedAt: Date;
}>
```

#### `xfilter.unmuteAccount`
Hesabı sessize almaktan çıkar

```typescript
// Mutation
trpc.xfilter.unmuteAccount.useMutation()

// Input
{ accountHandle: string }

// Response
{ success: true }
```

---

### İstatistikler

#### `xfilter.getStats`
Belirli bir tarih için istatistikleri al

```typescript
// Query
trpc.xfilter.getStats.useQuery({
  date: "2026-03-10"; // YYYY-MM-DD
})

// Response
{
  date: string;
  hiddenCount: number;
  seenCount: number;
  estimatedTimeSaved: number;
  topAccounts: Record<string, number>;
  filterBreakdown: Record<string, number>;
}
```

#### `xfilter.getStatsRange`
Tarih aralığı için istatistikleri al

```typescript
// Query
trpc.xfilter.getStatsRange.useQuery({
  startDate: "2026-03-01";
  endDate: "2026-03-10";
  period: "daily" | "weekly" | "monthly";
})

// Response
Array<{
  date: string;
  hiddenCount: number;
  seenCount: number;
  estimatedTimeSaved: number;
  topAccounts: Record<string, number>;
}>
```

#### `xfilter.getAnalytics`
Gelişmiş analitik verileri al

```typescript
// Query
trpc.xfilter.getAnalytics.useQuery({
  period: "daily" | "weekly" | "monthly";
})

// Response
{
  totalHidden: number;
  totalSeen: number;
  totalTimeSaved: number;
  averagePerDay: number;
  trend: "up" | "down" | "stable";
  topAccounts: Array<{ account: string; count: number }>;
  filterBreakdown: Record<string, number>;
  activitySummary: string;
}
```

---

### AI Endpoints

#### `xfilter.summarizeTweet`
Tweet'i AI ile özetle

```typescript
// Mutation
trpc.xfilter.summarizeTweet.useMutation()

// Input
{
  tweetId: string;
  content: string;
}

// Response
{
  success: boolean;
  summary?: string;
  error?: string;
}
```

#### `xfilter.translateTweet`
Tweet'i AI ile çevir

```typescript
// Mutation
trpc.xfilter.translateTweet.useMutation()

// Input
{
  tweetId: string;
  content: string;
  targetLanguage: string; // e.g., "tr", "en", "es"
}

// Response
{
  success: boolean;
  translation?: string;
  error?: string;
}
```

---

### Payment Endpoints

#### `xfilter.createCheckoutSession`
Stripe checkout session oluştur

```typescript
// Mutation
trpc.xfilter.createCheckoutSession.useMutation()

// Input
{
  planType: "monthly" | "annual";
}

// Response
{
  checkoutUrl: string;
}
```

#### `xfilter.createCustomerPortal`
Stripe customer portal session oluştur

```typescript
// Mutation
trpc.xfilter.createCustomerPortal.useMutation()

// Response
{
  portalUrl: string;
}
```

---

### Email Endpoints

#### `xfilter.sendDailySummaryEmail`
Günlük özet emaili gönder

```typescript
// Mutation
trpc.xfilter.sendDailySummaryEmail.useMutation()

// Response
{
  success: boolean;
  messageId?: string;
}
```

#### `xfilter.sendProUpgradeEmail`
Pro upgrade emaili gönder

```typescript
// Mutation
trpc.xfilter.sendProUpgradeEmail.useMutation()

// Response
{
  success: boolean;
  messageId?: string;
}
```

---

### System Endpoints

#### `system.notifyOwner`
Proje sahibine bildirim gönder

```typescript
// Mutation
trpc.system.notifyOwner.useMutation()

// Input
{
  title: string;
  content: string;
}

// Response
{ success: boolean }
```

---

## Webhook Endpoints

### Stripe Webhooks

**Endpoint:** `POST /api/stripe/webhook`

**Events:**
- `checkout.session.completed` - Ödeme başarılı
- `customer.subscription.updated` - Subscription güncellendi
- `customer.subscription.deleted` - Subscription iptal edildi
- `invoice.paid` - Fatura ödendiği

**Signature Verification:**
```typescript
const signature = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  req.body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

---

## Error Handling

Tüm tRPC endpoint'leri aşağıdaki hata formatını döndürür:

```typescript
{
  code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR";
  message: string;
  cause?: unknown;
}
```

---

## Rate Limiting

- **Free Users:** 100 requests/minute
- **Pro Users:** 1000 requests/minute
- **AI Endpoints:** Free 10/month, Pro unlimited

---

## Authentication

Tüm protected endpoint'ler Manus OAuth session cookie'si gerektirir:

```typescript
// Cookie name
MANUS_SESSION

// Header
Cookie: MANUS_SESSION=<jwt_token>
```

---

## Examples

### JavaScript/TypeScript (tRPC)

```typescript
import { trpc } from "@/lib/trpc";

// Hide a tweet
const hideTweet = await trpc.xfilter.hideTweet.mutate({
  tweetId: "123456789",
  reason: "keyword",
});

// Get stats
const stats = await trpc.xfilter.getStats.query({
  date: "2026-03-10",
});

// Summarize tweet
const summary = await trpc.xfilter.summarizeTweet.mutate({
  tweetId: "123456789",
  content: "Tweet content here...",
});
```

### cURL

```bash
# Hide a tweet
curl -X POST http://localhost:3000/api/trpc/xfilter.hideTweet \
  -H "Content-Type: application/json" \
  -d '{"tweetId": "123456789", "reason": "keyword"}'

# Get stats
curl -X GET "http://localhost:3000/api/trpc/xfilter.getStats?date=2026-03-10"

# Create checkout session
curl -X POST http://localhost:3000/api/trpc/xfilter.createCheckoutSession \
  -H "Content-Type: application/json" \
  -d '{"planType": "monthly"}'
```

---

## Versioning

API version: **1.0.0**

Last updated: **10 March 2026**

---

## Support

For API support, contact: support@xfilterpro.com

Documentation: https://docs.xfilterpro.com
