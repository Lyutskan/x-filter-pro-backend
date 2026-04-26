-- Migration 0003: Password reset tokens
-- Run this on Railway MySQL after deploying the matching backend code.

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `token` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `password_reset_tokens_token_unique` (`token`),
  KEY `password_reset_tokens_userId_idx` (`userId`)
);
