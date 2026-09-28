ALTER TABLE `saved_articles`
  ADD COLUMN `retryWindowStartedAt` DATETIME(3) NULL,
  ADD COLUMN `generation` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `resultGeneration` INTEGER NULL,
  ADD COLUMN `generatedAt` DATETIME(3) NULL,
  ADD COLUMN `summaryPreview` TEXT NULL,
  ADD COLUMN `stage` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN `errorCode` VARCHAR(191) NULL,
  ADD COLUMN `retryable` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `retryAt` DATETIME(3) NULL,
  ADD COLUMN `sourceCompleteness` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN';

UPDATE `saved_articles`
SET `resultGeneration` = 0, `generatedAt` = `updatedAt`, `stage` = 'DONE'
WHERE JSON_TYPE(JSON_EXTRACT(`summaryMeta`, '$.summaryMarkdown')) = 'STRING'
  AND LENGTH(JSON_UNQUOTE(JSON_EXTRACT(`summaryMeta`, '$.summaryMarkdown'))) > 0;

UPDATE `saved_articles` SET `stage` = 'FAILED' WHERE `processStatus` = 'SUMMARY_FAILED';
UPDATE `saved_articles` SET `stage` = 'QUEUED' WHERE `processStatus` IN ('SAVED', 'SUMMARIZING');

CREATE TABLE `summary_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `articleId` VARCHAR(191) NOT NULL,
  `generation` INTEGER NOT NULL,
  `requestKey` VARCHAR(191) COLLATE utf8mb4_bin NULL,
  `state` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `notBefore` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseToken` VARCHAR(191) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `result` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `summary_tasks_articleId_generation_key` (`articleId`, `generation`),
  UNIQUE INDEX `summary_tasks_articleId_requestKey_key` (`articleId`, `requestKey`),
  INDEX `summary_tasks_state_notBefore_idx` (`state`, `notBefore`),
  INDEX `summary_tasks_state_leaseExpiresAt_idx` (`state`, `leaseExpiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `summary_tasks_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `saved_articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Recover pre-migration in-flight articles; no AI call occurs in migration.
INSERT INTO `summary_tasks` (`id`, `articleId`, `generation`, `updatedAt`)
SELECT CONCAT('legacy_', `id`), `id`, `generation`, CURRENT_TIMESTAMP(3)
FROM `saved_articles` WHERE `processStatus` IN ('SAVED', 'SUMMARIZING');

-- A recovered SAVED row is now a queued generation, so clients keep polling it.
UPDATE `saved_articles` SET `processStatus` = 'SUMMARIZING' WHERE `processStatus` = 'SAVED';
