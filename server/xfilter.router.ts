/**
 * X Filter Pro - Güvenli tRPC Router
 * Tüm API çağrıları sunucu tarafında doğrulanır, istemci bypass'ı imkansızdır
 */

import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getOrCreateSubscription,
  addSeenTweet,
  getSeenTweets,
  setSnoozeTweet,
  cleanExpiredSnooze,
  recordHiddenTweet,
  getStatsRange,
  getUserFilterRules,
  addFilterRule,
  getMutedAccounts,
  muteAccount,
  cleanExpiredMutes,
  logAiUsage,
  getAiUsageThisMonth,
  getAiUsageToday,
  registerDevice,
  getUserDevices,
} from "./db";
import { invokeLLM } from "./_core/llm";
import {
  generateAnalyticsReport,
  formatTimeSaved,
  generateDailySummary,
  analyzeTrend,
  summarizeUserActivity,
} from "./analytics.service";
import { createCheckoutSession, createCustomerPortalSession } from "./stripe.checkout";
import { generateDailySummaryEmail, generateProUpgradeEmail, sendEmail } from "./email.service";

async function checkMonthlyLimit(userId: number): Promise<boolean> {
  const sub = await getOrCreateSubscription(userId);
  if (sub.isPro) return true;
  const seenCount = (await getSeenTweets(userId)).length;
  return seenCount < (sub.monthlyLimit || 500);
}

async function checkAiLimit(userId: number): Promise<boolean> {
  const sub = await getOrCreateSubscription(userId);
  // FAZA 2: Günlük limit (Pro: 50, Free: 5)
  const dailyUsage = await getAiUsageToday(userId);
  const limit = sub.isPro ? 50 : 5;
  return dailyUsage < limit;
}

export const xfilterRouter = router({
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const sub = await getOrCreateSubscription(ctx.user.id);
    return {
      plan: sub.plan,
      isPro: sub.isPro,
      monthlyLimit: sub.monthlyLimit,
      aiMonthlyLimit: sub.aiMonthlyLimit,
      aiUsageToday: await getAiUsageToday(ctx.user.id),
      aiUsageThisMonth: await getAiUsageThisMonth(ctx.user.id),
      aiDailyLimit: sub.isPro ? 50 : 5,
    };
  }),

  recordSeenTweet: protectedProcedure
    .input(
      z.object({
        tweetFingerprint: z.string(),
        tweetId: z.string().optional(),
        hiddenReason: z.enum(["keyword", "link", "promoted", "muted", "follower_count", "account_age", "like_count", "retweet_count"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const canRecord = await checkMonthlyLimit(ctx.user.id);
      if (!canRecord) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Aylık limit aşıldı. Pro'ya yükseltin.",
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      await addSeenTweet(
        ctx.user.id,
        input.tweetFingerprint,
        input.tweetId,
        input.hiddenReason
      );
      await recordHiddenTweet(ctx.user.id, today, 5);

      return { success: true };
    }),

  getSyncedTweets: protectedProcedure
    .input(
      z.object({
        deviceId: z.string(),
        browserType: z.enum(["chrome", "firefox", "opera", "edge", "other"]),
        deviceName: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await registerDevice(
        ctx.user.id,
        input.deviceId,
        input.browserType,
        input.deviceName
      );

      const tweets = await getSeenTweets(ctx.user.id);
      return {
        tweets,
        totalCount: tweets.length,
      };
    }),

  snoozeTweet: protectedProcedure
    .input(
      z.object({
        tweetFingerprint: z.string(),
        snoozeHours: z.number().default(24),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setSnoozeTweet(
        ctx.user.id,
        input.tweetFingerprint,
        input.snoozeHours
      );
      return { success: true };
    }),

  cleanExpiredSnoozes: protectedProcedure.mutation(async ({ ctx }) => {
    const count = await cleanExpiredSnooze(ctx.user.id);
    return { cleanedCount: count };
  }),

  getStats: protectedProcedure
    .input(
      z.object({
        period: z.enum(["daily", "weekly", "monthly"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const today = new Date();
      let startDate: string;

      if (input.period === "daily") {
        startDate = today.toISOString().slice(0, 10);
      } else if (input.period === "weekly") {
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = weekAgo.toISOString().slice(0, 10);
      } else {
        const monthAgo = new Date(today.getFullYear(), today.getMonth(), 1);
        startDate = monthAgo.toISOString().slice(0, 10);
      }

      const endDate = today.toISOString().slice(0, 10);
      const stats = await getStatsRange(ctx.user.id, startDate, endDate);

      const totalHidden = stats.reduce((sum, s) => sum + (s.hiddenCount || 0), 0);
      const totalTimeSaved = stats.reduce((sum, s) => sum + (s.estimatedTimeSaved || 0), 0);

      return {
        period: input.period,
        totalHidden,
        totalTimeSaved,
        averagePerDay: Math.round(totalHidden / (stats.length || 1)),
        stats,
      };
    }),

  getFilterRules: protectedProcedure.query(async ({ ctx }) => {
    const rules = await getUserFilterRules(ctx.user.id);
    return { rules };
  }),

  addFilterRule: protectedProcedure
    .input(
      z.object({
        ruleType: z.enum(["keyword", "account", "link", "promoted", "follower_count", "account_age", "like_count", "retweet_count"]),
        ruleValue: z.string(),
        priority: z.number().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rule = await addFilterRule(
        ctx.user.id,
        input.ruleType,
        input.ruleValue,
        input.priority
      );
      return { rule };
    }),

  getMutedAccounts: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await getMutedAccounts(ctx.user.id);
    return { accounts };
  }),

  muteAccount: protectedProcedure
    .input(
      z.object({
        accountHandle: z.string(),
        muteHours: z.number().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await muteAccount(
        ctx.user.id,
        input.accountHandle,
        input.muteHours,
        input.reason
      );
      return { success: true };
    }),

  cleanExpiredMutes: protectedProcedure.mutation(async ({ ctx }) => {
    const count = await cleanExpiredMutes(ctx.user.id);
    return { cleanedCount: count };
  }),

  summarizeTweet: protectedProcedure
    .input(
      z.object({
        tweetText: z.string().max(5000),
        language: z.string().default("tr"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const canUseAi = await checkAiLimit(ctx.user.id);
      if (!canUseAi) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Günlük AI kullanım limitine ulaştınız. Pro'ya yükseltin.",
        });
      }

      const startTime = Date.now();

      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant that summarizes tweets concisely in ${input.language}. Keep summaries to 1-2 sentences.`,
            },
            {
              role: "user",
              content: `Summarize this tweet: ${input.tweetText}`,
            },
          ],
        });

        const responseTime = Date.now() - startTime;
        const summary = response.choices?.[0]?.message?.content || "";

        await logAiUsage(
          ctx.user.id,
          "summarize",
          Math.ceil(input.tweetText.length / 4),
          Math.ceil(summary.length / 4),
          0.001,
          responseTime,
          "success"
        );

        return {
          summary,
          success: true,
        };
      } catch (error) {
        await logAiUsage(
          ctx.user.id,
          "summarize",
          Math.ceil(input.tweetText.length / 4),
          0,
          0,
          Date.now() - startTime,
          "failed"
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI özetleme başarısız oldu",
        });
      }
    }),

  translateTweet: protectedProcedure
    .input(
      z.object({
        tweetText: z.string().max(5000),
        targetLanguage: z.string().default("en"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const canUseAi = await checkAiLimit(ctx.user.id);
      if (!canUseAi) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Günlük AI kullanım limitine ulaştınız. Pro'ya yükseltin.",
        });
      }

      const startTime = Date.now();

      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a professional translator. Translate the following tweet to ${input.targetLanguage}.`,
            },
            {
              role: "user",
              content: input.tweetText,
            },
          ],
        });

        const responseTime = Date.now() - startTime;
        const translation = response.choices?.[0]?.message?.content || "";

        await logAiUsage(
          ctx.user.id,
          "translate",
          Math.ceil(input.tweetText.length / 4),
          Math.ceil(translation.length / 4),
          0.001,
          responseTime,
          "success"
        );

        return {
          translation,
          success: true,
        };
      } catch (error) {
        await logAiUsage(
          ctx.user.id,
          "translate",
          Math.ceil(input.tweetText.length / 4),
          0,
          0,
          Date.now() - startTime,
          "failed"
        );

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Çeviri başarısız oldu",
        });
      }
    }),

  getDevices: protectedProcedure.query(async ({ ctx }) => {
    const devices = await getUserDevices(ctx.user.id);
    return { devices };
  }),

  /**
   * ========== ANALYTICS & REPORTING ==========
   */

  getAnalyticsReport: protectedProcedure
    .input(
      z.object({
        period: z.enum(["daily", "weekly", "monthly"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const report = await generateAnalyticsReport(ctx.user.id, input.period);
      return report;
    }),

  getDailySummary: protectedProcedure.query(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10);
    const stats = await getStatsRange(ctx.user.id, today, today);
    const summary = generateDailySummary(stats);
    return { summary };
  }),

  getTrend: protectedProcedure
    .input(
      z.object({
        days: z.number().default(7),
      })
    )
    .query(async ({ ctx, input }) => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - input.days * 24 * 60 * 60 * 1000);
      const stats = await getStatsRange(
        ctx.user.id,
        startDate.toISOString().slice(0, 10),
        endDate.toISOString().slice(0, 10)
      );
      const trend = analyzeTrend(stats);
      return trend;
    }),

  getUserActivitySummary: protectedProcedure.query(async ({ ctx }) => {
    // Son 90 günün verilerini al
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    const stats = await getStatsRange(
      ctx.user.id,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );
    const summary = summarizeUserActivity(stats);
    return summary;
  }),

  /**
   * ========== STRIPE PAYMENT ==========
   */

  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        planType: z.enum(["monthly", "yearly"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Zaten Pro ise checkout'a izin verme
      const sub = await getOrCreateSubscription(ctx.user.id);
      if (sub.isPro) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are already a Pro member",
        });
      }

      const origin = ctx.req.headers.origin || "https://app.xfilterpro.com";
      const checkoutUrl = await createCheckoutSession({
        userId: ctx.user.id,
        userEmail: ctx.user.email || "",
        userName: ctx.user.name || "User",
        planType: input.planType,
        successUrl: `${origin}/payment-success`,
        cancelUrl: `${origin}/payment-cancel`,
      });

      return { checkoutUrl };
    }),

  createCustomerPortal: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getOrCreateSubscription(ctx.user.id);

    if (!sub.stripeCustomerId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No Stripe customer found",
      });
    }

    const origin = ctx.req.headers.origin || "https://app.xfilterpro.com";
    const portalUrl = await createCustomerPortalSession(
      sub.stripeCustomerId,
      `${origin}/settings`
    );

    return { portalUrl };
  }),

  /**
   * ========== EMAIL NOTIFICATIONS ==========
   */

  sendDailySummaryEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const today = new Date().toISOString().slice(0, 10);
    const stats = await getStatsRange(ctx.user.id, today, today);

    if (stats.length === 0) {
      return { success: false, message: "No stats for today" };
    }

    const stat = stats[0];
    const topAccounts = stat.topAccounts
      ? Object.entries(stat.topAccounts as Record<string, number>)
          .map(([account, count]) => ({ account, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      : [];

    const template = await generateDailySummaryEmail(ctx.user.name || "User", {
      totalHidden: stat.hiddenCount || 0,
      totalSeen: stat.seenCount || 0,
      totalTimeSaved: stat.estimatedTimeSaved || 0,
      topAccounts,
    });

    const result = await sendEmail(ctx.user.email || "", template);
    return result;
  }),

  sendProUpgradeEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const template = await generateProUpgradeEmail(ctx.user.name || "User");
    const result = await sendEmail(ctx.user.email || "", template);
    return result;
  }),
});

export type XFilterRouter = typeof xfilterRouter;

// Helper function to format time for display
export function formatTimeDisplay(seconds: number): string {
  return formatTimeSaved(seconds);
}

// Payment helper
export async function getCheckoutUrl(
  userId: number,
  planType: "monthly" | "annual",
  origin: string
): Promise<string> {
  return createCheckoutSession({
    userId,
    userEmail: "",
    userName: "User",
    planType,
    successUrl: `${origin}/payment-success`,
    cancelUrl: `${origin}/payment-cancel`,
  });
}
