ALTER TABLE `saved_articles`
    ADD COLUMN `summaryMeta` JSON NULL,
    ADD COLUMN `extractionStatus` VARCHAR(191) NULL,
    ADD COLUMN `extractionConfidence` DOUBLE NULL,
    ADD COLUMN `summaryRetryCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastSummaryError` TEXT NULL;
