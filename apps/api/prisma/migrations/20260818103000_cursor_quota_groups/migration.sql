-- Custom groups for cursor quota accounts

CREATE TABLE `cursor_quota_groups` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `sort` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cursor_quota_groups_name_key` (`name`),
  INDEX `cursor_quota_groups_sort_idx` (`sort`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cursor_quota_accounts`
  ADD COLUMN `groupId` INTEGER NULL,
  ADD INDEX `cursor_quota_accounts_groupId_idx` (`groupId`);

ALTER TABLE `cursor_quota_accounts`
  ADD CONSTRAINT `cursor_quota_accounts_groupId_fkey`
    FOREIGN KEY (`groupId`) REFERENCES `cursor_quota_groups`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
