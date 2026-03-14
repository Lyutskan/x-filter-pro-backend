import { describe, it, expect } from "vitest";
import { shouldHideTweet, validateFilterRule, isMutedAccountActive } from "./filters";
import type { FilterRule } from "../drizzle/schema";

describe("Filter Engine", () => {
  describe("shouldHideTweet", () => {
    it("should hide tweet matching keyword rule", () => {
      const tweet = {
        text: "This is a spam tweet about crypto",
        authorHandle: "@user123",
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "keyword",
          ruleValue: JSON.stringify(["spam", "crypto"]),
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("keyword");
    });

    it("should hide tweet from muted account", () => {
      const tweet = {
        text: "Some tweet",
        authorHandle: "@spammer",
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "account",
          ruleValue: JSON.stringify(["@spammer", "@troll"]),
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("account");
    });

    it("should hide promoted tweets", () => {
      const tweet = {
        text: "Buy now!",
        authorHandle: "@brand",
        isPromoted: true,
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "promoted",
          ruleValue: "{}",
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("promoted");
    });

    it("should hide tweets with external links", () => {
      const tweet = {
        text: "Check this out",
        authorHandle: "@user",
        hasExternalLink: true,
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "link",
          ruleValue: "{}",
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("link");
    });

    it("should hide tweets from low-follower accounts", () => {
      const tweet = {
        text: "Some tweet",
        authorHandle: "@newuser",
        authorFollowers: 50,
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "follower_count",
          ruleValue: JSON.stringify({ minFollowers: 100 }),
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("follower_count");
    });

    it("should not hide tweet if no rules match", () => {
      const tweet = {
        text: "Normal tweet",
        authorHandle: "@user",
        authorFollowers: 1000,
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "keyword",
          ruleValue: JSON.stringify(["spam"]),
          isActive: true,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(false);
    });

    it("should respect rule priority", () => {
      const tweet = {
        text: "spam tweet",
        authorHandle: "@user",
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "keyword",
          ruleValue: JSON.stringify(["spam"]),
          isActive: true,
          priority: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          userId: 1,
          ruleType: "account",
          ruleValue: JSON.stringify(["@user"]),
          isActive: true,
          priority: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(true);
      expect(result.reason).toBe("keyword"); // Higher priority rule matches first
    });

    it("should ignore inactive rules", () => {
      const tweet = {
        text: "spam tweet",
        authorHandle: "@user",
      };

      const rules: FilterRule[] = [
        {
          id: 1,
          userId: 1,
          ruleType: "keyword",
          ruleValue: JSON.stringify(["spam"]),
          isActive: false,
          priority: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = shouldHideTweet(tweet, rules);
      expect(result.shouldHide).toBe(false);
    });
  });

  describe("validateFilterRule", () => {
    it("should validate keyword rule", () => {
      const result = validateFilterRule("keyword", JSON.stringify(["spam", "ads"]));
      expect(result.valid).toBe(true);
    });

    it("should reject empty keyword array", () => {
      const result = validateFilterRule("keyword", JSON.stringify([]));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("non-empty array");
    });

    it("should validate follower_count rule", () => {
      const result = validateFilterRule("follower_count", JSON.stringify({ minFollowers: 100 }));
      expect(result.valid).toBe(true);
    });

    it("should reject negative follower count", () => {
      const result = validateFilterRule("follower_count", JSON.stringify({ minFollowers: -10 }));
      expect(result.valid).toBe(false);
    });

    it("should reject invalid JSON", () => {
      const result = validateFilterRule("keyword", "not json");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid JSON");
    });
  });

  describe("isMutedAccountActive", () => {
    it("should return true for permanent mute (null)", () => {
      expect(isMutedAccountActive(null)).toBe(true);
    });

    it("should return true for future mute date", () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      expect(isMutedAccountActive(futureDate)).toBe(true);
    });

    it("should return false for past mute date", () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      expect(isMutedAccountActive(pastDate)).toBe(false);
    });
  });
});
