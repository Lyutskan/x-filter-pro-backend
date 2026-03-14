CREATE TABLE `aiUsageLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`operationType` enum('summarize','translate','analyze') NOT NULL,
	`inputTokens` int NOT NULL DEFAULT 0,
	`outputTokens` int NOT NULL DEFAULT 0,
	`estimatedCost` decimal(10,6) NOT NULL DEFAULT '0',
	`responseTime` int NOT NULL,
	`status` enum('success','failed','rate_limited') NOT NULL DEFAULT 'success',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiUsageLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dailyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`hiddenCount` int NOT NULL DEFAULT 0,
	`seenCount` int NOT NULL DEFAULT 0,
	`estimatedTimeSaved` int NOT NULL DEFAULT 0,
	`topAccounts` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyStats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deviceSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`deviceId` varchar(255) NOT NULL,
	`browserType` enum('chrome','firefox','opera','edge','other') NOT NULL,
	`deviceName` varchar(255),
	`lastSyncedAt` timestamp NOT NULL DEFAULT (now()),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deviceSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `filterRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`ruleType` enum('keyword','account','link','promoted','follower_count','account_age','like_count','retweet_count') NOT NULL,
	`ruleValue` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `filterRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mutedAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountHandle` varchar(100) NOT NULL,
	`muteUntil` timestamp,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mutedAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seenTweets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tweetFingerprint` varchar(255) NOT NULL,
	`tweetId` varchar(64),
	`seenAt` timestamp NOT NULL DEFAULT (now()),
	`snoozeUntil` timestamp,
	`snoozeShown` boolean NOT NULL DEFAULT false,
	`hiddenReason` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seenTweets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`plan` enum('free','pro') NOT NULL DEFAULT 'free',
	`isPro` boolean NOT NULL DEFAULT false,
	`monthlyLimit` int NOT NULL DEFAULT 500,
	`aiUsageCount` int NOT NULL DEFAULT 0,
	`aiMonthlyLimit` int NOT NULL DEFAULT 10,
	`stripeCustomerId` varchar(255),
	`stripeSubscriptionId` varchar(255),
	`renewalDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `isPro` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `aiUsageLog` ADD CONSTRAINT `aiUsageLog_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyStats` ADD CONSTRAINT `dailyStats_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deviceSessions` ADD CONSTRAINT `deviceSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `filterRules` ADD CONSTRAINT `filterRules_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mutedAccounts` ADD CONSTRAINT `mutedAccounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `seenTweets` ADD CONSTRAINT `seenTweets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `aiUsageLog_userId_idx` ON `aiUsageLog` (`userId`);--> statement-breakpoint
CREATE INDEX `dailyStats_userId_date_idx` ON `dailyStats` (`userId`,`date`);--> statement-breakpoint
CREATE INDEX `deviceSessions_userId_idx` ON `deviceSessions` (`userId`);--> statement-breakpoint
CREATE INDEX `filterRules_userId_idx` ON `filterRules` (`userId`);--> statement-breakpoint
CREATE INDEX `mutedAccounts_userId_idx` ON `mutedAccounts` (`userId`);--> statement-breakpoint
CREATE INDEX `seenTweets_userId_idx` ON `seenTweets` (`userId`);--> statement-breakpoint
CREATE INDEX `seenTweets_snoozeUntil_idx` ON `seenTweets` (`snoozeUntil`);