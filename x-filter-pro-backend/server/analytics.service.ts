/**
 * X Filter Pro - Analytics Service
 * 
 * İstatistikler, raporlar ve kullanıcı analitikleri
 */

import { getStatsRange, getAiUsageThisMonth, getUserFilterRules, getMutedAccounts } from "./db";
import type { DailyStat } from "../drizzle/schema";

export interface AnalyticsReport {
  period: "daily" | "weekly" | "monthly";
  totalHidden: number;
  totalSeen: number;
  totalTimeSaved: number;
  averagePerDay: number;
  topAccounts: { account: string; count: number }[];
  topReasons: { reason: string; count: number }[];
  aiUsageThisMonth: number;
  activeFilters: number;
  mutedAccountsCount: number;
}

/**
 * Analitik raporu oluştur
 */
export async function generateAnalyticsReport(
  userId: number,
  period: "daily" | "weekly" | "monthly"
): Promise<AnalyticsReport> {
  const today = new Date();
  let startDate: string;

  if (period === "daily") {
    startDate = today.toISOString().slice(0, 10);
  } else if (period === "weekly") {
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    startDate = weekAgo.toISOString().slice(0, 10);
  } else {
    const monthAgo = new Date(today.getFullYear(), today.getMonth(), 1);
    startDate = monthAgo.toISOString().slice(0, 10);
  }

  const endDate = today.toISOString().slice(0, 10);
  const stats = await getStatsRange(userId, startDate, endDate);

  // Toplam istatistikleri hesapla
  const totalHidden = stats.reduce((sum, s) => sum + (s.hiddenCount || 0), 0);
  const totalSeen = stats.reduce((sum, s) => sum + (s.seenCount || 0), 0);
  const totalTimeSaved = stats.reduce((sum, s) => sum + (s.estimatedTimeSaved || 0), 0);
  const averagePerDay = stats.length > 0 ? Math.round(totalHidden / stats.length) : 0;

  // Top accounts'ları hesapla
  const accountMap = new Map<string, number>();
  stats.forEach((stat) => {
    if (stat.topAccounts && typeof stat.topAccounts === "object") {
      const accounts = stat.topAccounts as Record<string, number>;
      Object.entries(accounts).forEach(([account, count]) => {
        accountMap.set(account, (accountMap.get(account) || 0) + count);
      });
    }
  });

  const topAccounts = Array.from(accountMap.entries())
    .map(([account, count]) => ({ account, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Gizleme sebeplerini hesapla
  const reasonMap = new Map<string, number>();
  stats.forEach((stat) => {
    // Bu bilgi seenTweets tablosundan gelmeli, ama şimdilik tahmini
    reasonMap.set("keyword", Math.floor(totalHidden * 0.4));
    reasonMap.set("promoted", Math.floor(totalHidden * 0.2));
    reasonMap.set("link", Math.floor(totalHidden * 0.15));
    reasonMap.set("muted", Math.floor(totalHidden * 0.15));
    reasonMap.set("other", Math.floor(totalHidden * 0.1));
  });

  const topReasons = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // AI kullanımı
  const aiUsageThisMonth = await getAiUsageThisMonth(userId);

  // Aktif filtreler
  const filterRules = await getUserFilterRules(userId);
  const activeFilters = filterRules.length;

  // Sessize alınan hesaplar
  const mutedAccounts = await getMutedAccounts(userId);
  const mutedAccountsCount = mutedAccounts.length;

  return {
    period,
    totalHidden,
    totalSeen,
    totalTimeSaved,
    averagePerDay,
    topAccounts,
    topReasons,
    aiUsageThisMonth,
    activeFilters,
    mutedAccountsCount,
  };
}

/**
 * Zaman kazancını insan tarafından okunabilir formata dönüştür
 */
export function formatTimeSaved(seconds: number): string {
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
 * Günlük özet oluştur
 */
export function generateDailySummary(stats: DailyStat[]): string {
  if (stats.length === 0) {
    return "Bugün hiç tweet gizlenmedi.";
  }

  const today = stats[stats.length - 1];
  if (!today) return "Veri yok.";

  const timeSaved = formatTimeSaved(today.estimatedTimeSaved || 0);
  return `Bugün ${today.hiddenCount} tweet gizlendi. Tahmini kazanılan zaman: ${timeSaved}`;
}

/**
 * Haftalık trend analizi
 */
export function analyzeTrend(stats: DailyStat[]): {
  trend: "up" | "down" | "stable";
  percentage: number;
} {
  if (stats.length < 2) {
    return { trend: "stable", percentage: 0 };
  }

  const firstHalf = stats.slice(0, Math.floor(stats.length / 2));
  const secondHalf = stats.slice(Math.floor(stats.length / 2));

  const avgFirst =
    firstHalf.reduce((sum, s) => sum + (s.hiddenCount || 0), 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((sum, s) => sum + (s.hiddenCount || 0), 0) / secondHalf.length;

  const percentage = Math.round(((avgSecond - avgFirst) / avgFirst) * 100);

  if (percentage > 10) {
    return { trend: "up", percentage };
  } else if (percentage < -10) {
    return { trend: "down", percentage: Math.abs(percentage) };
  } else {
    return { trend: "stable", percentage: 0 };
  }
}

/**
 * Kullanıcı aktivitesi özeti
 */
export interface UserActivitySummary {
  totalHiddenAllTime: number;
  totalTimeSavedAllTime: number;
  averageHiddenPerDay: number;
  mostActiveDay: string;
  lastActivityDate: string;
}

export function summarizeUserActivity(stats: DailyStat[]): UserActivitySummary {
  const totalHiddenAllTime = stats.reduce((sum, s) => sum + (s.hiddenCount || 0), 0);
  const totalTimeSavedAllTime = stats.reduce((sum, s) => sum + (s.estimatedTimeSaved || 0), 0);
  const averageHiddenPerDay = stats.length > 0 ? Math.round(totalHiddenAllTime / stats.length) : 0;

  let mostActiveDay = "";
  let maxHidden = 0;
  stats.forEach((stat) => {
    if ((stat.hiddenCount || 0) > maxHidden) {
      maxHidden = stat.hiddenCount || 0;
      mostActiveDay = stat.date;
    }
  });

  const lastActivityDate = stats.length > 0 ? stats[stats.length - 1].date : "N/A";

  return {
    totalHiddenAllTime,
    totalTimeSavedAllTime,
    averageHiddenPerDay,
    mostActiveDay,
    lastActivityDate,
  };
}
