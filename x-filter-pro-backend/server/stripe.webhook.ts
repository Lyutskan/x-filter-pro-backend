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
