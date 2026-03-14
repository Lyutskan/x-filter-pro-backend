/**
 * Stripe Routes
 * 
 * Express router'a Stripe webhook endpoint'ini eklemek için
 * server/_core/index.ts dosyasında kullanılır
 */

import { Router } from "express";
import { handleStripeWebhook } from "./stripe.webhook";

export function createStripeRouter(): Router {
  const router = Router();

  /**
   * Stripe Webhook Endpoint
   * POST /api/stripe/webhook
   * 
   * Stripe olaylarını işler:
   * - checkout.session.completed
   * - customer.subscription.updated
   * - customer.subscription.deleted
   * - invoice.paid
   */
  router.post("/webhook", handleStripeWebhook);

  return router;
}
