-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_articles` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` ENUM('THREADS') NOT NULL DEFAULT 'THREADS',
    `url` TEXT NOT NULL,
    `normalizedUrl` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `author` VARCHAR(191) NULL,
    `rawText` LONGTEXT NULL,
    `summary` TEXT NULL,
    `keyPoints` JSON NULL,
    `tags` JSON NULL,
    `processStatus` ENUM('SAVED', 'SUMMARIZING', 'SUMMARY_DONE', 'SUMMARY_FAILED', 'CONTEXT_INSUFFICIENT') NOT NULL DEFAULT 'SAVED',
    `readStatus` ENUM('UNREAD', 'READ', 'READ_LATER') NOT NULL DEFAULT 'UNREAD',
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `saved_articles_userId_savedAt_idx`(`userId`, `savedAt`),
    INDEX `saved_articles_userId_processStatus_idx`(`userId`, `processStatus`),
    INDEX `saved_articles_userId_readStatus_idx`(`userId`, `readStatus`),
    UNIQUE INDEX `saved_articles_userId_normalizedUrl_key`(`userId`, `normalizedUrl`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `thread_groups` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `status` ENUM('PARTIAL', 'COMPLETE', 'MERGED_SUMMARY_DONE') NOT NULL DEFAULT 'PARTIAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `thread_groups_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `thread_parts` (
    `id` VARCHAR(191) NOT NULL,
    `threadGroupId` VARCHAR(191) NOT NULL,
    `savedArticleId` VARCHAR(191) NOT NULL,
    `partNumber` INTEGER NOT NULL,
    `totalParts` INTEGER NOT NULL,
    `url` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `thread_parts_threadGroupId_partNumber_key`(`threadGroupId`, `partNumber`),
    UNIQUE INDEX `thread_parts_savedArticleId_key`(`savedArticleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `saved_articles` ADD CONSTRAINT `saved_articles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `thread_groups` ADD CONSTRAINT `thread_groups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `thread_parts` ADD CONSTRAINT `thread_parts_threadGroupId_fkey` FOREIGN KEY (`threadGroupId`) REFERENCES `thread_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `thread_parts` ADD CONSTRAINT `thread_parts_savedArticleId_fkey` FOREIGN KEY (`savedArticleId`) REFERENCES `saved_articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
