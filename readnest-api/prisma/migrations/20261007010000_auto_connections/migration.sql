CREATE TABLE `connection_scans` (
  `articleId` VARCHAR(191) NOT NULL,
  `sourceGeneration` INTEGER NOT NULL,
  `state` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `errorCode` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `connection_scans_state_updatedAt_idx` (`state`, `updatedAt`),
  PRIMARY KEY (`articleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auto_connections` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `leftArticleId` VARCHAR(191) NOT NULL,
  `rightArticleId` VARCHAR(191) NOT NULL,
  `leftGeneration` INTEGER NOT NULL,
  `rightGeneration` INTEGER NOT NULL,
  `relationType` VARCHAR(24) NOT NULL,
  `reason` VARCHAR(280) NOT NULL,
  `leftEvidence` VARCHAR(180) NOT NULL,
  `rightEvidence` VARCHAR(180) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `auto_connections_leftArticleId_rightArticleId_key` (`leftArticleId`, `rightArticleId`),
  INDEX `auto_connections_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `auto_connections_rightArticleId_idx` (`rightArticleId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `connection_scans` ADD CONSTRAINT `connection_scans_articleId_fkey`
  FOREIGN KEY (`articleId`) REFERENCES `saved_articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auto_connections` ADD CONSTRAINT `auto_connections_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auto_connections` ADD CONSTRAINT `auto_connections_leftArticleId_fkey`
  FOREIGN KEY (`leftArticleId`) REFERENCES `saved_articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auto_connections` ADD CONSTRAINT `auto_connections_rightArticleId_fkey`
  FOREIGN KEY (`rightArticleId`) REFERENCES `saved_articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
