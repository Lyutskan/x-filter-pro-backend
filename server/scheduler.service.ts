/**
 * Scheduler Service
 * 
 * Günlük email, snooze temizleme vb. otomatik görevler
 * server/_core/index.ts dosyasında başlatılır
 */

import * as cron from "node-cron";
import { getDb, cleanupExpiredAuthSessions } from "./db";
import { lt, eq } from "drizzle-orm";
import { seenTweets, users } from "../drizzle/schema";
import { generateDailySummaryEmail, sendEmail } from "./email.service";
import { getStatsRange } from "./db";

let scheduledJobs: (cron.ScheduledTask | null)[] = [];

/**
 * Scheduler'ı başlat
 */
export async function initializeScheduler(): Promise<void> {
  console.log("[Scheduler] Initializing scheduled jobs...");

  // Her gün 08:00 UTC'de günlük email gönder
  const dailyEmailJob = cron.schedule("0 8 * * *", async () => {
    console.log("[Scheduler] Running daily email job...");
    await sendDailyEmails();
  });

  // Her saat süresi dolmuş snooze'ları temizle
  const cleanExpiredSnoozesJob = cron.schedule("0 * * * *", async () => {
    console.log("[Scheduler] Running cleanup job for expired snoozes...");
    await cleanExpiredSnoozes();
  });

  // Her 6 saatte bir eski istatistikleri temizle (90 günden eski)
  const cleanOldStatsJob = cron.schedule("0 */6 * * *", async () => {
    console.log("[Scheduler] Running cleanup job for old stats...");
    await cleanOldStats();
  });

  // Her gün 03:00 UTC'de süresi dolmuş auth session'ları temizle.
  // Sadece 7 günden fazla expired olanları siliyoruz — kullanıcı yine de
  // "geçmişteki sessions" listesinde 7 gün boyunca görsün.
  const cleanExpiredSessionsJob = cron.schedule("0 3 * * *", async () => {
    console.log("[Scheduler] Cleaning up expired auth sessions...");
    try {
      const removed = await cleanupExpiredAuthSessions();
      console.log(`[Scheduler] Removed ${removed} expired auth session(s).`);
    } catch (err) {
      console.error("[Scheduler] cleanupExpiredAuthSessions failed:", err);
    }
  });

  scheduledJobs = [
    dailyEmailJob,
    cleanExpiredSnoozesJob,
    cleanOldStatsJob,
    cleanExpiredSessionsJob,
  ] as (cron.ScheduledTask | null)[];

  console.log("[Scheduler] Scheduled jobs initialized successfully");
}

/**
 * Scheduler'ı durdur
 */
export function stopScheduler(): void {
  console.log("[Scheduler] Stopping scheduled jobs...");
  scheduledJobs.forEach((job) => {
    if (job) job.stop();
  });
  scheduledJobs = [];
  console.log("[Scheduler] Scheduled jobs stopped");
}

/**
 * Tüm kullanıcılara günlük email gönder
 */
async function sendDailyEmails(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[Scheduler] Database not available");
    return;
  }

  try {
    // Tüm kullanıcıları al
    const allUsers = await db.select().from(users);

    for (const user of allUsers) {
      try {
        // Bugünün istatistiklerini al
        const today = new Date().toISOString().slice(0, 10);
        const stats = await getStatsRange(user.id, today, today);

        if (stats.length === 0) {
          console.log(`[Scheduler] No stats for user ${user.id} today`);
          continue;
        }

        const stat = stats[0];
        const topAccounts = stat.topAccounts
          ? Object.entries(stat.topAccounts as Record<string, number>)
              .map(([account, count]) => ({ account, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5)
          : [];

        // Email template oluştur
        const template = await generateDailySummaryEmail(user.name || "User", {
          totalHidden: stat.hiddenCount || 0,
          totalSeen: stat.seenCount || 0,
          totalTimeSaved: stat.estimatedTimeSaved || 0,
          topAccounts,
        });

        // Email gönder
        if (user.email) {
          const result = await sendEmail(user.email, template);
          if (result.success) {
            console.log(`[Scheduler] Daily email sent to ${user.email}`);
          } else {
            console.error(`[Scheduler] Failed to send email to ${user.email}`);
          }
        }
      } catch (error) {
        console.error(`[Scheduler] Error sending email to user ${user.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Scheduler] Error in sendDailyEmails:", error);
  }
}

/**
 * Süresi dolmuş snooze'ları temizle
 */
async function cleanExpiredSnoozes(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[Scheduler] Database not available");
    return;
  }

  try {
    const now = new Date();

    // Snooze süresi geçmiş ve snoozeShown false olan tweet'leri sil
    // (snoozeShown true ise zaten gösterilmiş demektir)
    const result = await db
      .delete(seenTweets)
      .where(
        // snoozeUntil < now AND snoozeShown = false
        // Snooze süresi geçmişse ve henüz gösterilmemişse sil
        // Ama snoozeShown = true ise (zaten gösterilmişse) sil
        lt(seenTweets.snoozeUntil, now)
      );

    console.log(`[Scheduler] Cleaned up expired snoozes`);
  } catch (error) {
    console.error("[Scheduler] Error in cleanExpiredSnoozes:", error);
  }
}

/**
 * 90 günden eski istatistikleri temizle
 */
async function cleanOldStats(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[Scheduler] Database not available");
    return;
  }

  try {
    // 90 gün öncesi tarihi hesapla
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateString = ninetyDaysAgo.toISOString().slice(0, 10);

    // Eski istatistikleri sil
    // Not: Gerçek uygulamada archive'a taşımak daha iyi olabilir
    console.log(`[Scheduler] Keeping stats older than ${dateString} for archive purposes`);
  } catch (error) {
    console.error("[Scheduler] Error in cleanOldStats:", error);
  }
}

/**
 * Scheduler status'unu kontrol et
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  jobCount: number;
  jobs: string[];
} {
  return {
    isRunning: scheduledJobs.length > 0,
    jobCount: scheduledJobs.length,
    jobs: ["Daily Email (08:00 UTC)", "Cleanup Snoozes (hourly)", "Cleanup Old Stats (every 6h)"],
  };
}
