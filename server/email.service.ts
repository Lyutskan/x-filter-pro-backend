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
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hey ${userName}! 👋</h2>
          <p>Here's your daily X Filter Pro summary:</p>
          
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>📊 Today's Stats</h3>
            <ul>
              <li><strong>Tweets Hidden:</strong> ${stats.totalHidden}</li>
              <li><strong>Tweets Seen:</strong> ${stats.totalSeen}</li>
              <li><strong>Time Saved:</strong> ${timeSavedFormatted}</li>
            </ul>
          </div>

          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>🔥 Top Accounts Hidden</h3>
            <ul>
              ${topAccountsList}
            </ul>
          </div>

          <p>Keep filtering! 🚀</p>
          <p>
            <a href="https://app.xfilterpro.com/dashboard" 
               style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
              View Full Dashboard
            </a>
          </p>

          <hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #999;">
            You're receiving this email because you have email notifications enabled.
            <a href="https://app.xfilterpro.com/settings" style="color: #007bff;">Manage preferences</a>
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

      View your full dashboard: https://app.xfilterpro.com/dashboard
    `,
  };
}

/**
 * Pro upgrade invitation emaili
 */
export async function generateProUpgradeEmail(userName: string): Promise<EmailTemplate> {
  return {
    subject: "Upgrade to X Filter Pro - Unlimited Features! 🚀",
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hey ${userName}! 🎉</h2>
          <p>You're using X Filter Pro and we love it! Ready to unlock unlimited features?</p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <h3>✨ Upgrade to Pro</h3>
            <p>Get unlimited AI features, advanced analytics, and priority support</p>
            <p style="font-size: 24px; font-weight: bold; margin: 20px 0;">
              $9.99/month or $89.99/year
            </p>
            <a href="https://app.xfilterpro.com/upgrade" 
               style="background: white; color: #667eea; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
              Upgrade Now
            </a>
          </div>

          <h3>Pro Features:</h3>
          <ul>
            <li>✅ Unlimited tweet filtering</li>
            <li>✅ Unlimited AI summarization</li>
            <li>✅ Unlimited AI translation</li>
            <li>✅ Cross-device sync (Chrome, Firefox, Opera)</li>
            <li>✅ Advanced analytics & reports</li>
            <li>✅ Priority support</li>
          </ul>

          <p>
            <a href="https://app.xfilterpro.com/upgrade" 
               style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
              Upgrade to Pro
            </a>
          </p>

          <hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #999;">
            <a href="https://app.xfilterpro.com/settings" style="color: #007bff;">Manage email preferences</a>
          </p>
        </body>
      </html>
    `,
    text: `
      Hey ${userName}!

      You're using X Filter Pro and we love it! Ready to unlock unlimited features?

      ✨ Upgrade to Pro
      $9.99/month or $89.99/year

      Pro Features:
      ✅ Unlimited tweet filtering
      ✅ Unlimited AI summarization
      ✅ Unlimited AI translation
      ✅ Cross-device sync
      ✅ Advanced analytics
      ✅ Priority support

      Upgrade now: https://app.xfilterpro.com/upgrade
    `,
  };
}

/**
 * Payment success emaili
 */
export async function generatePaymentSuccessEmail(
  userName: string,
  planType: "monthly" | "annual"
): Promise<EmailTemplate> {
  const planName = planType === "monthly" ? "Monthly" : "Annual";
  const renewalText =
    planType === "monthly"
      ? "Your subscription will renew automatically every month."
      : "Your subscription will renew automatically every year.";

  return {
    subject: "Welcome to X Filter Pro! 🎉",
    html: `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Welcome to Pro, ${userName}! 🎉</h2>
          <p>Thank you for upgrading to X Filter Pro ${planName}!</p>
          
          <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #155724;">✅ Upgrade Successful!</h3>
            <p style="color: #155724;">
              Your Pro features are now active. ${renewalText}
            </p>
          </div>

          <h3>You now have access to:</h3>
          <ul>
            <li>✅ Unlimited tweet filtering</li>
            <li>✅ Unlimited AI summarization</li>
            <li>✅ Unlimited AI translation</li>
            <li>✅ Cross-device sync</li>
            <li>✅ Advanced analytics</li>
            <li>✅ Priority support</li>
          </ul>

          <p>
            <a href="https://app.xfilterpro.com/dashboard" 
               style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
              Start Using Pro Features
            </a>
          </p>

          <h3>Need Help?</h3>
          <p>
            Check out our <a href="https://docs.xfilterpro.com" style="color: #007bff;">documentation</a> or 
            <a href="https://support.xfilterpro.com" style="color: #007bff;">contact support</a>.
          </p>

          <hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;">
          <p style="font-size: 12px; color: #999;">
            <a href="https://app.xfilterpro.com/settings" style="color: #007bff;">Manage subscription</a>
          </p>
        </body>
      </html>
    `,
    text: `
      Welcome to Pro, ${userName}!

      Thank you for upgrading to X Filter Pro ${planName}!

      ✅ Upgrade Successful!
      Your Pro features are now active. ${renewalText}

      You now have access to:
      ✅ Unlimited tweet filtering
      ✅ Unlimited AI summarization
      ✅ Unlimited AI translation
      ✅ Cross-device sync
      ✅ Advanced analytics
      ✅ Priority support

      Start using Pro features: https://app.xfilterpro.com/dashboard

      Need help? Contact support: https://support.xfilterpro.com
    `,
  };
}

/**
 * Zaman kazancını insan tarafından okunabilir formata dönüştür
 */
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
