CREATE TABLE `summary_variants` (
  `id` VARCHAR(191) NOT NULL,
  `articleId` VARCHAR(191) NOT NULL,
  `density` ENUM('CONCISE', 'DETAILED') NOT NULL,
  `generation` INTEGER NOT NULL DEFAULT 0,
  `sourceGeneration` INTEGER NOT NULL,
  `state` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `markdown` LONGTEXT NULL,
  `errorCode` VARCHAR(191) NULL,
  `retryable` BOOLEAN NOT NULL DEFAULT true,
  `retryAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `generatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `summary_variants_articleId_density_key` (`articleId`, `density`),
  INDEX `summary_variants_articleId_sourceGeneration_idx` (`articleId`, `sourceGeneration`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `summary_variant_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `variantId` VARCHAR(191) NOT NULL,
  `generation` INTEGER NOT NULL,
  `sourceGeneration` INTEGER NOT NULL,
  `requestKey` VARCHAR(191) NULL,
  `state` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `notBefore` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseToken` VARCHAR(191) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `result` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `summary_variant_tasks_variantId_generation_key` (`variantId`, `generation`),
  UNIQUE INDEX `summary_variant_tasks_variantId_requestKey_key` (`variantId`, `requestKey`),
  INDEX `summary_variant_tasks_state_notBefore_idx` (`state`, `notBefore`),
  INDEX `summary_variant_tasks_state_leaseExpiresAt_idx` (`state`, `leaseExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `summary_variants`
  ADD CONSTRAINT `summary_variants_articleId_fkey`
  FOREIGN KEY (`articleId`) REFERENCES `saved_articles`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `summary_variant_tasks`
  ADD CONSTRAINT `summary_variant_tasks_variantId_fkey`
  FOREIGN KEY (`variantId`) REFERENCES `summary_variants`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
