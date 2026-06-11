-- 回收（退款申请）记录表

CREATE TABLE `recycle_requests` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `invoiceNumber` VARCHAR(128) NOT NULL,
  `plan` VARCHAR(32) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `mailMessageId` VARCHAR(255) NULL,
  `lastCheckedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `recycle_requests_email_idx`(`email`),
  INDEX `recycle_requests_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
