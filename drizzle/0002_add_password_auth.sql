-- Migration 0002: Add password-based auth support
-- Run this on Railway MySQL via the database console or `drizzle-kit migrate`

-- 1. Add new columns
ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255);
ALTER TABLE `users` ADD COLUMN `emailVerified` boolean NOT NULL DEFAULT true;

-- 2. Make openId nullable (for new email/password users who don't have OAuth)
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(64);

-- 3. Make email NOT NULL and unique (was nullable before)
-- First, ensure no existing users have NULL email
UPDATE `users` SET `email` = CONCAT('legacy-', `openId`, '@manus.local') WHERE `email` IS NULL;
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;

-- 4. Add unique index on email (drop and recreate if exists)
-- MySQL syntax: cannot use IF NOT EXISTS on unique constraint, use try-catch in app code
-- Run this manually if first time:
-- ALTER TABLE `users` ADD UNIQUE INDEX `users_email_unique` (`email`);

-- Note: openId already has a unique index from the original schema. It stays.
