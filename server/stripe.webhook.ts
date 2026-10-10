/**
 * Stripe Webhook Handler
 * 
 * checkout.session.completed ve customer.subscription.updated olaylarını işler
 */

import Stripe from "stripe";
import { Request, Response } from "express";
import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { users, subscriptions } from "../drizzle/schema";
import { sendEmailViaSendGrid } from "./sendgrid.service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

/**
 * Webhook signature verification ve event processing
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[Webhook] Signature verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  // Test events için özel handling
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
    return res.json({
      verified: true,
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * Handle checkout.session.completed event
 * Kullanıcıyı Pro plana yükselt
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const userId = parseInt(session.client_reference_id || "0");
  const stripeCustomerId = session.customer as string;
  const stripeSubscriptionId = session.subscription as string;

  if (!userId || !stripeCustomerId) {
    console.error("[Webhook] Missing userId or stripeCustomerId");
    return;
  }

  console.log(`[Webhook] Checkout completed for user ${userId}`);

  // Update subscription
  await db
    .update(subscriptions)
    .set({
      plan: "pro",
      isPro: true,
      stripeCustomerId,
      stripeSubscriptionId,
      monthlyLimit: 999999, // Unlimited
      aiMonthlyLimit: 999999, // Unlimited
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));

  // Update user isPro flag
  await db
    .update(users)
    .set({
      isPro: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  console.log(`[Webhook] User ${userId} upgraded to Pro`);
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const stripeCustomerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));

  if (subs.length === 0) {
    console.warn(`[Webhook] No subscription found for customer ${stripeCustomerId}`);
    return;
  }

  const sub = subs[0];
  const isActive = subscription.status === "active";

  console.log(`[Webhook] Subscription ${subscription.id} updated: ${subscription.status}`);

  // Update subscription status
  await db
    .update(subscriptions)
    .set({
      isPro: isActive,
      plan: isActive ? "pro" : "free",
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  // Update user isPro flag
  await db
    .update(users)
    .set({
      isPro: isActive,
      updatedAt: new Date(),
    })
    .where(eq(users.id, sub.userId));
}

/**
 * Handle customer.subscription.deleted event
 * Kullanıcıyı Free plana indir
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const stripeCustomerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));

  if (subs.length === 0) {
    console.warn(`[Webhook] No subscription found for customer ${stripeCustomerId}`);
    return;
  }

  const sub = subs[0];

  console.log(`[Webhook] Subscription ${subscription.id} deleted`);

  // Downgrade to free plan
  await db
    .update(subscriptions)
    .set({
      plan: "free",
      isPro: false,
      monthlyLimit: 500,
      aiMonthlyLimit: 10,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  // Update user isPro flag
  await db
    .update(users)
    .set({
      isPro: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, sub.userId));
}

/**
 * Handle invoice.paid event
 * Ödeme başarılı oldu
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeCustomerId = invoice.customer as string;

  console.log(`[Webhook] Invoice ${invoice.id} paid for customer ${stripeCustomerId}`);

  // Burada email gönderme, notification oluşturma vb. yapılabilir
  // Şimdilik sadece log tutuyoruz
}
/**
 * Handle invoice.payment_failed event
 * Customer's payment was declined. Send notification email.
 * Stripe retries automatically (up to 4 times over ~3 weeks).
 * Subscription status changes come via separate customer.subscription.updated events.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const db = await getDb();
  if (!db) {
    console.error("[Webhook] payment_failed: db not available");
    return;
  }

  const stripeCustomerId = invoice.customer as string;
  const attemptCount = invoice.attempt_count || 1;
  const nextAttemptTs = invoice.next_payment_attempt;
  const amountDue = ((invoice.amount_due || 0) / 100).toFixed(2);
  const currency = (invoice.currency || "usd").toUpperCase();

  console.log(
    `[Webhook] invoice.payment_failed: customer ${stripeCustomerId}, ` +
    `attempt ${attemptCount}, amount ${amountDue} ${currency}`
  );

  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));

  if (subs.length === 0) {
    console.warn(`[Webhook] payment_failed: no subscription for customer ${stripeCustomerId}`);
    return;
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, subs[0].userId));

  if (userRows.length === 0 || !userRows[0].email) {
    console.warn(`[Webhook] payment_failed: user/email not found for sub ${subs[0].id}`);
    return;
  }

  const user = userRows[0];
  const nextAttemptDate = nextAttemptTs
    ? new Date(nextAttemptTs * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const subject =
    attemptCount === 1
      ? "Heads up — your X Filter Pro payment was declined"
      : attemptCount === 2
      ? "Payment retry failed — please update your card"
      : "Final notice — your X Filter Pro subscription will be cancelled";

  const html = buildPaymentFailedEmailHtml({
    name: user.name ?? null,
    attemptCount,
    nextAttemptDate,
    amountDue,
    currency,
  });

  const text = buildPaymentFailedEmailText({
    name: user.name ?? null,
    attemptCount,
    nextAttemptDate,
    amountDue,
    currency,
  });

  try {
    await sendEmailViaSendGrid(user.email, { subject, html, text });
    console.log(
      `[Webhook] payment_failed: notified ${user.email} ` +
      `(attempt ${attemptCount}, next: ${nextAttemptDate || "none"})`
    );
  } catch (err) {
    console.error("[Webhook] payment_failed: email send failed:", err);
  }
}

function buildPaymentFailedEmailHtml(params: {
  name: string | null;
  attemptCount: number;
  nextAttemptDate: string | null;
  amountDue: string;
  currency: string;
}): string {
  const { name, attemptCount, nextAttemptDate, amountDue, currency } = params;
  const SITE = process.env.SITE_URL || "https://xfilterpro.com";
  const greeting = name ? `Hi ${name},` : "Hi there,";

  const headline =
    attemptCount === 1
      ? "Your latest payment didn't go through"
      : attemptCount === 2
      ? "Payment retry failed — action needed"
      : "Final notice: subscription will be cancelled";

  const nextLine = nextAttemptDate
    ? `<p style="margin:16px 0;color:#475569;">We'll automatically retry the payment on <strong>${nextAttemptDate}</strong>. Please update your card before then to avoid any interruption.</p>`
    : `<p style="margin:16px 0;color:#475569;">This was the last automatic retry. Your subscription will be cancelled within 24 hours unless you update your payment method now.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${headline}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="background:#FFD166;padding:20px 28px;">
      <h1 style="margin:0;font-size:22px;color:#0f172a;font-weight:800;">X Filter Pro</h1>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${headline}</h2>
      <p style="margin:0 0 8px;color:#334155;">${greeting}</p>
      <p style="margin:8px 0 16px;color:#334155;">
        We tried to charge <strong>${amountDue} ${currency}</strong> to your card on file, but the payment was declined.
      </p>
      ${nextLine}
      <div style="margin:28px 0;text-align:center;">
        <a href="${SITE}/account/billing" style="display:inline-block;background:#FFD166;color:#0f172a;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;">Update Payment Method</a>
      </div>
      <p style="margin:24px 0 8px;font-size:14px;color:#64748b;">Common reasons for declined payments:</p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#64748b;">
        <li>Card expired or cancelled</li>
        <li>Insufficient funds</li>
        <li>Bank flagged the charge as unusual</li>
        <li>3D Secure authentication needed</li>
      </ul>
      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
        Questions? Reply to this email or contact <a href="mailto:support@xfilterpro.com" style="color:#FFD166;">support@xfilterpro.com</a>.
      </p>
    </div>
    <div style="background:#f1f5f9;padding:16px 28px;text-align:center;font-size:12px;color:#94a3b8;">
      X Filter Pro · <a href="${SITE}" style="color:#94a3b8;text-decoration:underline;">xfilterpro.com</a>
    </div>
  </div>
</body>
</html>`;
}

function buildPaymentFailedEmailText(params: {
  name: string | null;
  attemptCount: number;
  nextAttemptDate: string | null;
  amountDue: string;
  currency: string;
}): string {
  const { name, attemptCount, nextAttemptDate, amountDue, currency } = params;
  const SITE = process.env.SITE_URL || "https://xfilterpro.com";
  const greeting = name ? `Hi ${name},` : "Hi there,";

  const headline =
    attemptCount === 1
      ? "Your latest payment didn't go through"
      : attemptCount === 2
      ? "Payment retry failed — action needed"
      : "Final notice: subscription will be cancelled";

  const nextLine = nextAttemptDate
    ? `We'll automatically retry the payment on ${nextAttemptDate}. Please update your card before then to avoid any interruption.`
    : `This was the last automatic retry. Your subscription will be cancelled within 24 hours unless you update your payment method now.`;

  return `${headline}

${greeting}

We tried to charge ${amountDue} ${currency} to your card on file, but the payment was declined.

${nextLine}

Update your payment method:
${SITE}/account/billing

Common reasons for declined payments:
- Card expired or cancelled
- Insufficient funds
- Bank flagged the charge as unusual
- 3D Secure authentication needed

Questions? Reply to this email or contact support@xfilterpro.com

— X Filter Pro
${SITE}`;
}
