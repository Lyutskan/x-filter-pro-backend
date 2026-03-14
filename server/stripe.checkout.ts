/**
 * Stripe Checkout Session Creator
 * 
 * Pro plana geçiş için checkout session oluşturur
 */

import Stripe from "stripe";
import { getProductByPlan, CheckoutSessionConfig } from "./stripe.products";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

/**
 * Checkout session oluştur
 */
export async function createCheckoutSession(config: CheckoutSessionConfig): Promise<string> {
  const product = getProductByPlan(config.planType);

  // Stripe session oluştur
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: product.currency,
          product_data: {
            name: product.name,
            description: product.description,
          },
          unit_amount: product.priceInCents,
          recurring: {
            interval: config.planType === "monthly" ? "month" : "year",
            interval_count: 1,
          },
        },
        quantity: 1,
      },
    ],
    mode: "subscription",
    customer_email: config.userEmail,
    client_reference_id: config.userId.toString(),
    metadata: {
      user_id: config.userId.toString(),
      customer_email: config.userEmail,
      customer_name: config.userName,
      plan_type: config.planType,
    },
    success_url: config.successUrl,
    cancel_url: config.cancelUrl,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: {
        user_id: config.userId.toString(),
        plan_type: config.planType,
      },
    },
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }

  return session.url;
}

/**
 * Customer portal session oluştur (subscription yönetimi için)
 */
export async function createCustomerPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  if (!session.url) {
    throw new Error("Failed to create customer portal session");
  }

  return session.url;
}

/**
 * Subscription bilgilerini al
 */
export async function getSubscriptionDetails(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Customer bilgilerini al
 */
export async function getCustomerDetails(customerId: string): Promise<Stripe.Customer> {
  return stripe.customers.retrieve(customerId) as Promise<Stripe.Customer>;
}
