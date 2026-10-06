CREATE TABLE `knowledge_topics` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `nameKey` CHAR(64) NOT NULL,
  `description` TEXT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `knowledge_topics_userId_nameKey_key` (`userId`, `nameKey`),
  INDEX `knowledge_topics_userId_createdAt_id_idx` (`userId`, `createdAt`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `topic_articles` (
  `topicId` VARCHAR(191) NOT NULL,
  `articleId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `topic_articles_articleId_topicId_idx` (`articleId`, `topicId`),
  PRIMARY KEY (`topicId`, `articleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `knowledge_topics` ADD CONSTRAINT `knowledge_topics_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `topic_articles` ADD CONSTRAINT `topic_articles_topicId_fkey`
  FOREIGN KEY (`topicId`) REFERENCES `knowledge_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `topic_articles` ADD CONSTRAINT `topic_articles_articleId_fkey`
  FOREIGN KEY (`articleId`) REFERENCES `saved_articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
