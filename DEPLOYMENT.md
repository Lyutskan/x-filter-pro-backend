# X Filter Pro Backend - Deployment Rehberi

## Production Deployment Checklist

### 1. Environment Variables

Aşağıdaki environment variable'ları production ortamında ayarlayın:

```bash
# Database
DATABASE_URL=mysql://user:password@host:3306/xfilterpro

# OAuth
VITE_APP_ID=your_manus_app_id
OAUTH_SERVER_URL=https://api.manus.im
JWT_SECRET=your_jwt_secret_key

# Stripe
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_your_key

# SendGrid
SENDGRID_API_KEY=SG.your_api_key
SENDGRID_FROM_EMAIL=noreply@xfilterpro.com

# Manus Built-in APIs
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=your_forge_api_key
VITE_FRONTEND_FORGE_API_URL=https://api.manus.im
VITE_FRONTEND_FORGE_API_KEY=your_frontend_key

# Owner Info
OWNER_NAME=Your Name
OWNER_OPEN_ID=your_open_id

# Analytics (opsiyonel)
VITE_ANALYTICS_WEBSITE_ID=your_website_id
VITE_ANALYTICS_ENDPOINT=https://analytics.example.com

# App Config
VITE_APP_TITLE=X Filter Pro
VITE_APP_LOGO=https://cdn.example.com/logo.png
NODE_ENV=production
PORT=3000
```

### 2. Database Migration

Production database'ini hazırla:

```bash
# 1. Veritabanını oluştur
CREATE DATABASE xfilterpro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 2. Drizzle migration'larını çalıştır
pnpm drizzle-kit migrate

# 3. Veritabanı bağlantısını test et
npm run check
```

### 3. Build Process

```bash
# 1. Dependencies yükle
pnpm install --frozen-lockfile

# 2. TypeScript check
pnpm check

# 3. Tests çalıştır
pnpm test

# 4. Production build
pnpm build

# 5. Build output'unu kontrol et
ls -la dist/
```

### 4. Stripe Setup

#### Test Mode (Development)

1. Stripe Dashboard'a git: https://dashboard.stripe.com
2. Test keys'i kopyala:
   - Publishable key: `pk_test_...`
   - Secret key: `sk_test_...`
3. Webhook secret'ı oluştur:
   - Developers → Webhooks → Add endpoint
   - Endpoint URL: `https://your-domain.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
   - Secret'ı kopyala: `whsec_test_...`

#### Live Mode (Production)

1. Stripe KYC verification'ı tamamla
2. Live keys'i kopyala:
   - Publishable key: `pk_live_...`
   - Secret key: `sk_live_...`
3. Webhook secret'ı oluştur:
   - Endpoint URL: `https://your-domain.com/api/stripe/webhook`
   - Secret'ı kopyala: `whsec_live_...`
4. Webhook event'lerini test et

### 5. SendGrid Setup

1. SendGrid'e kaydol: https://sendgrid.com
2. API key oluştur:
   - Settings → API Keys → Create API Key
   - Permissions: Mail Send, Template Engine
   - Key'i kopyala: `SG.xxxxx`
3. Sender verification:
   - Settings → Sender Authentication
   - Domain authentication veya Single Sender Verification
4. Email template'lerini oluştur (opsiyonel)

### 6. SSL/TLS Certificate

Production ortamında HTTPS kullanmak zorunludur:

```bash
# Let's Encrypt ile certificate oluştur
certbot certonly --standalone -d your-domain.com

# Certificate'ı server'a kopyala
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /path/to/cert/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem /path/to/key/
```

### 7. Server Configuration

#### Node.js Process Manager (PM2)

```bash
# PM2 yükle
npm install -g pm2

# Ecosystem config dosyası oluştur
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'x-filter-pro-backend',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    ignore_watch: ['node_modules', 'logs'],
  }]
};
EOF

# PM2 ile başlat
pm2 start ecosystem.config.js

# Startup script oluştur
pm2 startup
pm2 save
```

#### Nginx Reverse Proxy

```nginx
upstream x_filter_pro {
    server localhost:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert/fullchain.pem;
    ssl_certificate_key /path/to/key/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_min_length 1000;

    location / {
        proxy_pass http://x_filter_pro;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # Stripe webhook - raw body
    location /api/stripe/webhook {
        client_max_body_size 10m;
        proxy_pass http://x_filter_pro;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 8. Monitoring & Logging

#### Application Logs

```bash
# PM2 logs
pm2 logs x-filter-pro-backend

# Real-time logs
pm2 monit

# Specific log file
tail -f ./logs/out.log
```

#### Health Check Endpoint (opsiyonel)

```typescript
// server/routers.ts dosyasına ekle
health: publicProcedure.query(async () => {
  const db = await getDb();
  return {
    status: "ok",
    timestamp: new Date(),
    database: db ? "connected" : "disconnected",
    scheduler: getSchedulerStatus(),
  };
}),
```

#### Monitoring Tools

- **Uptime Monitoring:** Pingdom, UptimeRobot
- **Error Tracking:** Sentry, Rollbar
- **Performance:** New Relic, Datadog
- **Logs:** ELK Stack, Splunk

### 9. Backup Strategy

```bash
# Daily database backup
0 2 * * * mysqldump -u user -p password xfilterpro | gzip > /backups/xfilterpro_$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
find /backups -name "xfilterpro_*.sql.gz" -mtime +30 -delete

# Upload to S3
aws s3 sync /backups s3://your-backup-bucket/xfilterpro/
```

### 10. Security Checklist

- [ ] HTTPS/SSL enabled
- [ ] Environment variables secured (not in code)
- [ ] Database password strong
- [ ] Stripe API keys secured
- [ ] SendGrid API key secured
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Input validation enabled
- [ ] SQL injection prevention
- [ ] XSS protection headers
- [ ] CSRF protection
- [ ] Regular security updates
- [ ] Firewall configured
- [ ] DDoS protection (CloudFlare, AWS Shield)

### 11. Performance Optimization

```bash
# Enable compression
gzip on

# Cache static assets
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# Database query optimization
# - Add indexes on frequently queried columns
# - Use connection pooling
# - Monitor slow queries

# Application optimization
# - Enable HTTP/2
# - Use CDN for static assets
# - Implement caching (Redis)
# - Optimize database queries
```

### 12. Deployment Steps

```bash
# 1. Production server'a SSH ile bağlan
ssh user@your-domain.com

# 2. Repository'yi clone et
git clone https://github.com/yourusername/x-filter-pro-backend.git
cd x-filter-pro-backend

# 3. Dependencies yükle
pnpm install --frozen-lockfile

# 4. Environment variables ayarla
nano .env.production

# 5. Build et
pnpm build

# 6. Database migrate et
pnpm drizzle-kit migrate

# 7. PM2 ile başlat
pm2 start ecosystem.config.js

# 8. Logs kontrol et
pm2 logs x-filter-pro-backend

# 9. Health check
curl https://your-domain.com/api/trpc/system.health
```

### 13. Troubleshooting

#### Server başlamıyor
```bash
# Logs kontrol et
pm2 logs x-filter-pro-backend

# Port açık mı?
netstat -tlnp | grep 3000

# Dependencies eksik mi?
pnpm install
```

#### Database bağlantısı başarısız
```bash
# Connection string kontrol et
echo $DATABASE_URL

# MySQL server çalışıyor mu?
mysql -u user -p -h host -e "SELECT 1"
```

#### Webhook'lar alınmıyor
```bash
# Stripe webhook logs
# Dashboard → Developers → Webhooks → Event delivery

# Webhook secret doğru mu?
echo $STRIPE_WEBHOOK_SECRET

# Endpoint accessible mi?
curl -X POST https://your-domain.com/api/stripe/webhook
```

#### Email'ler gönderilmiyor
```bash
# SendGrid API key doğru mu?
echo $SENDGRID_API_KEY

# SendGrid dashboard'da sender verified mi?
# Settings → Sender Authentication

# Logs kontrol et
pm2 logs x-filter-pro-backend | grep SendGrid
```

---

## Rollback Plan

Eğer deployment başarısız olursa:

```bash
# 1. Önceki version'u al
git log --oneline | head -5

# 2. Önceki commit'e dön
git checkout <commit_hash>

# 3. Rebuild ve restart
pnpm build
pm2 restart x-filter-pro-backend

# 4. Health check
curl https://your-domain.com/api/trpc/system.health
```

---

## Post-Deployment

- [ ] Health check endpoint'i test et
- [ ] Stripe webhook'ları test et
- [ ] Email gönderme test et
- [ ] Database backup'ı test et
- [ ] SSL certificate'ı doğrula
- [ ] Performance metrics'i kontrol et
- [ ] Error logs'ı kontrol et
- [ ] User feedback'i al

---

**Son Güncelleme:** 10 Mart 2026
