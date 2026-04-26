/**
 * SendGrid Email Service
 * 
 * Gerçek email gönderme için SendGrid entegrasyonu
 * Environment variable: SENDGRID_API_KEY
 */

import type { EmailTemplate } from "./email.service";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM || "support@xfilterpro.com";

/**
 * SendGrid API'ye istek gönder
 */
async function sendViaAPI(
  to: string,
  subject: string,
  htmlContent: string,
  textContent: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!SENDGRID_API_KEY) {
    console.warn("[SendGrid] SENDGRID_API_KEY not configured, using mock");
    return { success: true, messageId: `mock_${Date.now()}` };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
            subject: subject,
          },
        ],
        from: {
          email: SENDGRID_FROM_EMAIL,
          name: "X Filter Pro",
        },
        content: [
          // SendGrid requires text/plain to come before text/html.
          // Otherwise the API returns: "text/plain must be first, followed by text/html".
          {
            type: "text/plain",
            value: textContent,
          },
          {
            type: "text/html",
            value: htmlContent,
          },
        ],
        reply_to: {
          email: "support@xfilterpro.com",
        },
      }),
    });

    if (response.ok) {
      const messageId = response.headers.get("x-message-id") || `msg_${Date.now()}`;
      console.log(`[SendGrid] Email sent successfully to ${to} (${messageId})`);
      return { success: true, messageId };
    } else {
      const error = await response.text();
      console.error(`[SendGrid] Failed to send email: ${error}`);
      return { success: false, error };
    }
  } catch (error) {
    console.error("[SendGrid] Error sending email:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * SendGrid üzerinden email gönder
 */
export async function sendEmailViaSendGrid(
  to: string,
  template: EmailTemplate
): Promise<{ success: boolean; messageId?: string }> {
  return sendViaAPI(to, template.subject, template.html, template.text);
}

/**
 * Batch email gönder (birden fazla alıcı)
 */
export async function sendBatchEmailsViaSendGrid(
  recipients: { email: string; name?: string }[],
  template: EmailTemplate
): Promise<{ success: boolean; successCount: number; failureCount: number }> {
  if (!SENDGRID_API_KEY) {
    console.warn("[SendGrid] SENDGRID_API_KEY not configured, using mock");
    return { success: true, successCount: recipients.length, failureCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;

  for (const recipient of recipients) {
    try {
      const result = await sendViaAPI(
        recipient.email,
        template.subject,
        template.html,
        template.text
      );

      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (error) {
      failureCount++;
      console.error(`[SendGrid] Error sending to ${recipient.email}:`, error);
    }
  }

  return {
    success: failureCount === 0,
    successCount,
    failureCount,
  };
}

/**
 * SendGrid configuration status
 */
export function getSendGridStatus(): {
  configured: boolean;
  apiKey: string;
  fromEmail: string;
} {
  return {
    configured: !!SENDGRID_API_KEY,
    apiKey: SENDGRID_API_KEY ? "***" : "NOT_SET",
    fromEmail: SENDGRID_FROM_EMAIL,
  };
}
