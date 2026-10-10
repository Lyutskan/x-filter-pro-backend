/**
 * Email Service
 * 
 * Kullanıcılara email göndermek için
 * Günlük/haftalık özet, Pro upgrade notifications vb.
 */

import { invokeLLM } from "./_core/llm";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Günlük özet emaili oluştur
 */
export async function generateDailySummaryEmail(
  userName: string,
  stats: {
    totalHidden: number;
    totalSeen: number;
    totalTimeSaved: number;
    topAccounts: { account: string; count: number }[];
  }
): Promise<EmailTemplate> {
  const timeSavedFormatted = formatTimeSaved(stats.totalTimeSaved);
  const topAccountsList = stats.topAccounts
    .slice(0, 5)
    .map((acc) => `<li>${acc.account}: ${acc.count} tweets</li>`)
    .join("");

  return {
    subject: `Your X Filter Pro Daily Summary - ${new Date().toLocaleDateString()}`,
    html: `
      <html>
        <body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e8e8f0;">
    <div style="max-width:560px;margin:0 auto;padding:48px 24px;">
      <div style="background:#14141e;border:1px solid #1e1e30;border-radius:16px;padding:36px 32px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
          <div style="width:32px;height:32px;background:linear-gradient(135deg,#ffd166,#f7b733);border-radius:7px;"></div>
          <span style="font-weight:700;font-size:16px;color:#e8e8f0;">X Filter <span style="color:#ffd166">Pro</span></span>
        </div>
        <h2 style="font-size:20px;font-weight:800;margin:0 0 14px;color:#e8e8f0;">Hey ${userName}! 👋</h2>
          <p>Here's your daily X Filter Pro summary:</p>
          
          <div style="background:#1a1a2e;border:1px solid #2a2a44;border-radius:10px;padding:20px;margin:20px 0;">
            <h3 style="color:#ffd166;font-size:14px;margin:0 0 12px;">📊 Today's Stats</h3>
            <ul>
              <li><strong>Tweets Hidden:</strong> ${stats.totalHidden}</li>
              <li><strong>Tweets Seen:</strong> ${stats.totalSeen}</li>
              <li><strong>Time Saved:</strong> ${timeSavedFormatted}</li>
            </ul>
          </div>

          <div style="background:#1a1a2e;border:1px solid #2a2a44;border-radius:10px;padding:20px;margin:20px 0;">
            <h3 style="color:#ffd166;font-size:14px;margin:0 0 12px;">🔥 Top Accounts Hidden</h3>
            <ul>
              ${topAccountsList}
            </ul>
          </div>

          <p>Keep filtering! 🚀</p>
          <p>
            <a href="https://xfilterpro.com/" 
               style="display:inline-block;background:linear-gradient(135deg,#ffd166,#f7b733);color:#000;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:14px;">
              View Full Dashboard
            </a>
          </p>

          <hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;">
          <p style="font-size:12px;color:#66668a;">
            You're receiving this because you have email notifications enabled.
            <a href="https://xfilterpro.com/" style="color:#6ee7f7;">Manage preferences</a>
          </p>
        </body>
      </html>
    `,
    text: `
      Hey ${userName}!

      Here's your daily X Filter Pro summary:

      📊 Today's Stats
      - Tweets Hidden: ${stats.totalHidden}
      - Tweets Seen: ${stats.totalSeen}
      - Time Saved: ${timeSavedFormatted}

      🔥 Top Accounts Hidden
      ${stats.topAccounts.map((acc) => `- ${acc.account}: ${acc.count} tweets`).join("\n")}

      Keep filtering! 🚀

      View your full dashboard: https://xfilterpro.com/
    `,
  };
}

/**
 * Pro upgrade invitation emaili
 */
export async function generateProUpgradeEmail(userName: string): Promise<EmailTemplate> {
  return {
    subject: "Unlock Pro features — X Filter Pro ⭐",
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e8e8f0;">
<div style="max-width:560px;margin:0 auto;padding:48px 24px;">
  <div style="background:#14141e;border:1px solid #1e1e30;border-radius:16px;padding:36px 32px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#ffd166,#f7b733);border-radius:7px;"></div>
      <span style="font-weight:700;font-size:16px;">X Filter <span style="color:#ffd166">Pro</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;">Hey \${userName}, ready to go Pro? ⭐</h1>
    <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 20px;">You're already blocking ads and filtering tweets. Unlock the full toolkit:</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">🤖 <strong style="color:#e8e8f0;">50 AI summaries/day</strong> (vs 5 free)</td></tr>
      <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">🔒 <strong style="color:#e8e8f0;">Hide external links</strong> — family-safe browsing</td></tr>
      <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">🖥️ <strong style="color:#e8e8f0;">Focus Mode</strong> — hide left nav &amp; sidebar</td></tr>
      <tr><td style="padding:8px 0;color:#aaa;font-size:13px;">☁️ <strong style="color:#e8e8f0;">Cloud Sync</strong> — settings across devices</td></tr>
    </table>
    <div style="background:#1a1a2e;border:1px solid #2a2a44;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
      <p style="color:#ffd166;font-size:28px;font-weight:800;margin:0 0 4px;">$2/month</p>
      <p style="color:#66668a;font-size:13px;margin:0;">or $20/year (save 17%)</p>
    </div>
    <div style="text-align:center;">
      <a href="https://xfilterpro.com/" style="display:inline-block;background:linear-gradient(135deg,#ffd166,#f7b733);color:#000;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Upgrade to Pro</a>
    </div>
    <hr style="border:none;border-top:1px solid #1e1e30;margin:24px 0;">
    <p style="color:#66668a;font-size:12px;margin:0;">Questions? Reply to this email or contact support@xfilterpro.com</p>
  </div>
  <p style="text-align:center;color:#66668a;font-size:11px;font-family:monospace;margin-top:24px;">&copy; 2026 X Filter Pro &middot; <a href="https://xfilterpro.com" style="color:#6ee7f7;">xfilterpro.com</a></p>
</div></body></html>`,
    text: `Hey \${userName}!

Ready to go Pro? Unlock the full toolkit:

🤖 50 AI summaries/day (vs 5 free)
🔒 Hide external links — family-safe browsing
🖥️ Focus Mode — hide left nav & sidebar
☁️ Cloud Sync — settings across devices

$2/month or $20/year (save 17%)

Upgrade: https://xfilterpro.com/

Questions? support@xfilterpro.com`,
  };
}

export async function generatePaymentSuccessEmail(
  userName: string,
  planType: "monthly" | "annual"
): Promise<EmailTemplate> {
  const planName = planType === "monthly" ? "Monthly" : "Annual";
  const renewalText =
    planType === "monthly"
      ? "Your subscription renews automatically every month."
      : "Your subscription renews automatically every year.";

  return {
    subject: "You're Pro now! 🎉 — X Filter Pro",
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e8e8f0;">
<div style="max-width:560px;margin:0 auto;padding:48px 24px;">
  <div style="background:#14141e;border:1px solid #1e1e30;border-radius:16px;padding:36px 32px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div style="width:32px;height:32px;background:linear-gradient(135deg,#ffd166,#f7b733);border-radius:7px;"></div>
      <span style="font-weight:700;font-size:16px;">X Filter <span style="color:#ffd166">Pro</span></span>
    </div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;">Welcome to Pro, \${userName}! 🎉</h1>
    <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 16px;">Thank you for upgrading to X Filter Pro \${planName}!</p>
    <div style="background:rgba(255,209,102,0.08);border:1px solid rgba(255,209,102,0.2);border-radius:10px;padding:16px;margin:0 0 20px;">
      <p style="color:#ffd166;font-weight:700;margin:0 0 4px;">✅ Pro features are now active</p>
      <p style="color:#aaa;font-size:13px;margin:0;">\${renewalText}</p>
    </div>
    <p style="color:#ffd166;font-size:13px;font-weight:700;margin:0 0 12px;">What's unlocked:</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">🤖 <strong style="color:#e8e8f0;">50 AI summaries/day</strong></td></tr>
      <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">🔒 <strong style="color:#e8e8f0;">Hide external links</strong></td></tr>
      <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">🖥️ <strong style="color:#e8e8f0;">Focus Mode</strong> (hide left nav &amp; sidebar)</td></tr>
      <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">☁️ <strong style="color:#e8e8f0;">Cloud Sync</strong></td></tr>
      <tr><td style="padding:6px 0;color:#aaa;font-size:13px;">📱 <strong style="color:#e8e8f0;">2 devices</strong> simultaneously</td></tr>
    </table>
    <div style="text-align:center;margin-top:20px;">
      <a href="https://xfilterpro.com/" style="display:inline-block;background:linear-gradient(135deg,#ffd166,#f7b733);color:#000;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px;">Start using Pro</a>
    </div>
    <hr style="border:none;border-top:1px solid #1e1e30;margin:24px 0;">
    <p style="color:#66668a;font-size:12px;margin:0;">Questions? Reply to this email or contact support@xfilterpro.com</p>
  </div>
  <p style="text-align:center;color:#66668a;font-size:11px;font-family:monospace;margin-top:24px;">&copy; 2026 X Filter Pro &middot; <a href="https://xfilterpro.com" style="color:#6ee7f7;">xfilterpro.com</a></p>
</div></body></html>`,
    text: `Welcome to Pro, \${userName}! 🎉

Thank you for upgrading to X Filter Pro \${planName}!

✅ Pro features are now active
\${renewalText}

What's unlocked:
🤖 50 AI summaries/day
🔒 Hide external links
🖥️ Focus Mode
☁️ Cloud Sync
📱 2 devices simultaneously

Start using Pro: https://xfilterpro.com/

Questions? support@xfilterpro.com`,
  };
}

function formatTimeSaved(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Email gönderme - SendGrid entegrasyonu ile
 */
export async function sendEmail(
  to: string,
  template: EmailTemplate
): Promise<{ success: boolean; messageId?: string }> {
  // SendGrid kullanılabiliyorsa, SendGrid'i kullan
  if (process.env.SENDGRID_API_KEY) {
    try {
      const { sendEmailViaSendGrid } = await import("./sendgrid.service");
      return sendEmailViaSendGrid(to, template);
    } catch (error) {
      console.error("[Email] Failed to use SendGrid, falling back to mock", error);
    }
  }

  // Mock response
  console.log(`[Email] Sending email to ${to} (mock)`);
  console.log(`[Email] Subject: ${template.subject}`);

  return {
    success: true,
    messageId: `msg_${Date.now()}`,
  };
}
