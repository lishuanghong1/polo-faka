-- 账号库：纯账号管理（分组 / 账号 / 操作历史）

CREATE TABLE `vault_groups` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `sort` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `vault_groups_name_key` (`name`),
  INDEX `vault_groups_sort_idx` (`sort`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vault_accounts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `passwordEnc` TEXT NULL,
  `emailPasswordEnc` TEXT NULL,
  `tokenEnc` TEXT NULL,
  `groupId` INTEGER NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  `tags` VARCHAR(255) NULL,
  `note` VARCHAR(500) NULL,
  `batchTag` VARCHAR(64) NULL,
  `expiresAt` DATETIME(3) NULL,
  `checkResult` VARCHAR(16) NULL,
  `checkMessage` VARCHAR(255) NULL,
  `membershipType` VARCHAR(32) NULL,
  `planUsedCents` INTEGER NULL,
  `planLimitCents` INTEGER NULL,
  `planPercent` DOUBLE NULL,
  `lastCheckAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `vault_accounts_email_key` (`email`),
  INDEX `vault_accounts_status_idx` (`status`),
  INDEX `vault_accounts_groupId_idx` (`groupId`),
  INDEX `vault_accounts_batchTag_idx` (`batchTag`),
  INDEX `vault_accounts_deletedAt_idx` (`deletedAt`),
  INDEX `vault_accounts_expiresAt_idx` (`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vault_account_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `accountId` INTEGER NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `detail` VARCHAR(255) NULL,
  `actorId` INTEGER NULL,
  `actor` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `vault_account_events_accountId_createdAt_idx` (`accountId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `vault_accounts`
  ADD CONSTRAINT `vault_accounts_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `vault_groups`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `vault_account_events`
  ADD CONSTRAINT `vault_account_events_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `vault_accounts`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
