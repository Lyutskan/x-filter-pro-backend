/**
 * Resend Email Service
 *
 * Environment variables:
 *   RESEND_API_KEY     - Resend API anahtarı (Mail gönderme yetkili)
 *   RESEND_FROM_EMAIL  - Gönderen adres, doğrulanmış domain altında olmalı (ör. support@xfilterpro.com)
 */

import type { EmailTemplate } from "./email.service";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || "support@xfilterpro.com";
const FROM_NAME = "X Filter Pro";
const REPLY_TO = "support@xfilterpro.com";

// Resend varsayılan olarak saniyede 2 istek sınırı uygular; toplu gönderimde bekleme ekliyoruz.
const BATCH_DELAY_MS = 600;

export interface ResendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmailViaResend(
  to: string,
  template: EmailTemplate
): Promise<ResendResult> {
  if (!RESEND_API_KEY) {
    console.warn("[Resend] RESEND_API_KEY not configured");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${RESEND_FROM_EMAIL}>`,
        to: [to],
        subject: template.subject,
        html: template.html,
        text: template.text,
        reply_to: REPLY_TO,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (response.ok && body.id) {
      console.log(`[Resend] Email sent to ${to} (${body.id})`);
      return { success: true, messageId: body.id };
    }

    const error = body.message ?? `HTTP ${response.status}`;
    console.error(`[Resend] Failed to send email to ${to}: ${JSON.stringify(body)}`);
    return { success: false, error };
  } catch (error) {
    console.error("[Resend] Error sending email:", error);
    return { success: false, error: String(error) };
  }
}

export async function sendBatchEmailsViaResend(
  recipients: { email: string }[],
  template: EmailTemplate
): Promise<{ success: boolean; successCount: number; failureCount: number }> {
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const result = await sendEmailViaResend(recipients[i].email, template);
    if (result.success) successCount++;
    else failureCount++;

    if (i < recipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return { success: failureCount === 0, successCount, failureCount };
}

export function getResendStatus(): { configured: boolean; fromEmail: string } {
  return {
    configured: !!RESEND_API_KEY,
    fromEmail: RESEND_FROM_EMAIL,
  };
}
