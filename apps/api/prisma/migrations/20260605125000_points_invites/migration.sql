-- Points and invitation system

ALTER TABLE `users`
  ADD COLUMN `points` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `inviteCode` VARCHAR(16) NULL,
  ADD COLUMN `inviterId` INTEGER NULL,
  ADD COLUMN `inviteRewardedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `users_inviteCode_key` ON `users`(`inviteCode`);
CREATE INDEX `users_inviterId_idx` ON `users`(`inviterId`);

ALTER TABLE `users`
  ADD CONSTRAINT `users_inviterId_fkey`
  FOREIGN KEY (`inviterId`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `orders`
  ADD COLUMN `pointsUsed` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `orders`
  MODIFY `payMethod` ENUM('ALIPAY', 'WECHAT', 'BALANCE', 'POINTS', 'USDT', 'MOCK', 'REDEEM') NOT NULL;

ALTER TABLE `recharge_orders`
  MODIFY `payMethod` ENUM('ALIPAY', 'WECHAT', 'BALANCE', 'POINTS', 'USDT', 'MOCK', 'REDEEM') NOT NULL DEFAULT 'ALIPAY';

CREATE TABLE `point_logs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `amount` INTEGER NOT NULL,
  `balance` INTEGER NOT NULL,
  `type` ENUM('ORDER_REWARD', 'INVITE_REWARD', 'ORDER_DEDUCT', 'ORDER_REFUND', 'ADMIN_ADJUST') NOT NULL,
  `note` VARCHAR(191) NULL,
  `refOrder` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `uniq_point_log_ref_type_user` ON `point_logs`(`refOrder`, `type`, `userId`);
CREATE INDEX `point_logs_userId_createdAt_idx` ON `point_logs`(`userId`, `createdAt`);
CREATE INDEX `point_logs_type_createdAt_idx` ON `point_logs`(`type`, `createdAt`);

ALTER TABLE `point_logs`
  ADD CONSTRAINT `point_logs_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
