/**
 * X Filter Pro - Filtreleme Motoru
 * 
 * Tüm filtreleme kuralları sunucu tarafında uygulanır.
 * İstemci tarafından bypass edilemez.
 */

import { FilterRule } from "../drizzle/schema";

export interface TweetData {
  text: string;
  authorHandle: string;
  authorFollowers?: number;
  authorAccountAge?: number;
  likeCount?: number;
  retweetCount?: number;
  hasExternalLink?: boolean;
  isPromoted?: boolean;
}

/**
 * Filtreleme kuralını değerlendir
 */
function evaluateRule(rule: FilterRule, tweet: TweetData): boolean {
  try {
    switch (rule.ruleType) {
      case "keyword": {
        const keywords = JSON.parse(rule.ruleValue) as string[];
        const lowerText = tweet.text.toLowerCase();
        return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
      }

      case "account": {
        const accounts = JSON.parse(rule.ruleValue) as string[];
        return accounts.some((acc) =>
          tweet.authorHandle.toLowerCase().includes(acc.toLowerCase())
        );
      }

      case "link": {
        return tweet.hasExternalLink === true;
      }

      case "promoted": {
        return tweet.isPromoted === true;
      }

      case "follower_count": {
        const { minFollowers } = JSON.parse(rule.ruleValue) as {
          minFollowers: number;
        };
        return (tweet.authorFollowers || 0) < minFollowers;
      }

      case "account_age": {
        const { minDays } = JSON.parse(rule.ruleValue) as { minDays: number };
        const accountAgeDays = tweet.authorAccountAge || 0;
        return accountAgeDays < minDays;
      }

      case "like_count": {
        const { minLikes } = JSON.parse(rule.ruleValue) as { minLikes: number };
        return (tweet.likeCount || 0) < minLikes;
      }

      case "retweet_count": {
        const { minRetweets } = JSON.parse(rule.ruleValue) as {
          minRetweets: number;
        };
        return (tweet.retweetCount || 0) < minRetweets;
      }

      default:
        return false;
    }
  } catch (error) {
    console.error(`Filter evaluation error for rule ${rule.id}:`, error);
    return false;
  }
}

/**
 * Tweet'in gizlenip gizlenmeyeceğini belirle
 * Tüm kurallar sunucu tarafında kontrol edilir
 */
export function shouldHideTweet(
  tweet: TweetData,
  rules: FilterRule[]
): { shouldHide: boolean; reason?: string } {
  // Kuralları önceliğe göre sırala (yüksek öncelik = önce kontrol et)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (!rule.isActive) continue;

    if (evaluateRule(rule, tweet)) {
      return {
        shouldHide: true,
        reason: rule.ruleType,
      };
    }
  }

  return { shouldHide: false };
}

/**
 * Filtreleme kuralı validasyonu
 */
export function validateFilterRule(
  ruleType: string,
  ruleValue: string
): { valid: boolean; error?: string } {
  try {
    switch (ruleType) {
      case "keyword": {
        const keywords = JSON.parse(ruleValue) as string[];
        if (!Array.isArray(keywords) || keywords.length === 0) {
          return { valid: false, error: "Keywords must be a non-empty array" };
        }
        if (!keywords.every((k) => typeof k === "string")) {
          return { valid: false, error: "All keywords must be strings" };
        }
        return { valid: true };
      }

      case "account": {
        const accounts = JSON.parse(ruleValue) as string[];
        if (!Array.isArray(accounts) || accounts.length === 0) {
          return { valid: false, error: "Accounts must be a non-empty array" };
        }
        if (!accounts.every((a) => typeof a === "string")) {
          return { valid: false, error: "All accounts must be strings" };
        }
        return { valid: true };
      }

      case "link": {
        return { valid: true };
      }

      case "promoted": {
        return { valid: true };
      }

      case "follower_count": {
        const data = JSON.parse(ruleValue) as { minFollowers?: number };
        if (typeof data.minFollowers !== "number" || data.minFollowers < 0) {
          return { valid: false, error: "minFollowers must be a positive number" };
        }
        return { valid: true };
      }

      case "account_age": {
        const data = JSON.parse(ruleValue) as { minDays?: number };
        if (typeof data.minDays !== "number" || data.minDays < 0) {
          return { valid: false, error: "minDays must be a positive number" };
        }
        return { valid: true };
      }

      case "like_count": {
        const data = JSON.parse(ruleValue) as { minLikes?: number };
        if (typeof data.minLikes !== "number" || data.minLikes < 0) {
          return { valid: false, error: "minLikes must be a positive number" };
        }
        return { valid: true };
      }

      case "retweet_count": {
        const data = JSON.parse(ruleValue) as { minRetweets?: number };
        if (typeof data.minRetweets !== "number" || data.minRetweets < 0) {
          return { valid: false, error: "minRetweets must be a positive number" };
        }
        return { valid: true };
      }

      default:
        return { valid: false, error: "Unknown rule type" };
    }
  } catch (error) {
    return { valid: false, error: `Invalid JSON: ${String(error)}` };
  }
}

/**
 * Muted account'un geçerli olup olmadığını kontrol et
 */
export function isMutedAccountActive(muteUntil: Date | null): boolean {
  if (muteUntil === null) return true; // Permanent mute
  return new Date() < muteUntil; // Temporary mute, still active
}
