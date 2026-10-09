CREATE TABLE `article_classifications` (
  `articleId` VARCHAR(191) NOT NULL,
  `sourceGeneration` INTEGER NOT NULL,
  `state` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `kind` VARCHAR(24) NOT NULL DEFAULT 'UNCLASSIFIED',
  `categories` JSON NOT NULL,
  `projectName` VARCHAR(100) NULL,
  `useCase` VARCHAR(300) NULL,
  `evidence` TEXT NULL,
  `userEdited` BOOLEAN NOT NULL DEFAULT false,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `leaseToken` VARCHAR(36) NULL,
  `errorCode` VARCHAR(40) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`articleId`),
  INDEX `article_classifications_state_updatedAt_idx` (`state`, `updatedAt`),
  INDEX `article_classifications_kind_idx` (`kind`),
  CONSTRAINT `article_classifications_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `saved_articles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
