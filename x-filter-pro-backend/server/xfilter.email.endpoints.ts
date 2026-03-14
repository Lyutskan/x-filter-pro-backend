/**
 * Email Endpoints for xfilter.router.ts
 * 
 * Bu dosyadaki kod xfilter.router.ts dosyasının
 * createCustomerPortal mutation'ından sonra eklenmelidir
 */

export const emailEndpoints = `
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
`;
