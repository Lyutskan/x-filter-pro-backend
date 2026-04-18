/**
 * Stripe Products Configuration
 * 
 * X Feed Filter Pro ürünleri ve fiyatlandırması
 */

export const STRIPE_PRODUCTS = {
  PRO_MONTHLY: {
    name: "X Filter Pro - Monthly",
    description: "Unlimited tweet filtering, AI features, and cross-device sync",
    priceInCents: 200, // $2.00/month
    interval: "month" as const,
    currency: "usd",
    features: [
      "Unlimited tweet filtering",
      "AI summarization (unlimited)",
      "AI translation (unlimited)",
      "Cross-device sync (Chrome, Firefox, Opera)",
      "Advanced analytics",
      "Priority support",
    ],
  },
  PRO_ANNUAL: {
    name: "X Filter Pro - Annual",
    description: "Unlimited tweet filtering, AI features, and cross-device sync (yearly)",
    priceInCents: 2000, // $20.00/year (20% discount)
    interval: "year" as const,
    currency: "usd",
    features: [
      "Unlimited tweet filtering",
      "AI summarization (unlimited)",
      "AI translation (unlimited)",
      "Cross-device sync (Chrome, Firefox, Opera)",
      "Advanced analytics",
      "Priority support",
      "Save 25% vs monthly",
    ],
  },
};

export const FREE_PLAN = {
  name: "X Filter Pro - Free",
  description: "Basic tweet filtering with limitations",
  features: [
    "500 tweets/month filtering",
    "10 AI operations/month",
    "Basic analytics",
    "Single device sync",
    "Community support",
  ],
};

/**
 * Stripe Checkout Session Configuration
 */
export interface CheckoutSessionConfig {
  userId: number;
  userEmail: string;
  userName: string;
  planType: "monthly" | "annual";
  successUrl: string;
  cancelUrl: string;
}

/**
 * Get product details by plan type
 */
export function getProductByPlan(planType: "monthly" | "annual") {
  return planType === "monthly" ? STRIPE_PRODUCTS.PRO_MONTHLY : STRIPE_PRODUCTS.PRO_ANNUAL;
}

/**
 * Format price for display
 */
export function formatPrice(priceInCents: number, currency: string = "usd"): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return formatter.format(priceInCents / 100);
}

/**
 * Calculate subscription renewal date
 */
export function calculateRenewalDate(interval: "month" | "year"): Date {
  const date = new Date();
  if (interval === "month") {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date;
}
