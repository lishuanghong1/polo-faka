-- Team 售号渠道（cursor.zhangyuwang.cn 成品号购买 API）：
-- 新增 CURSOR_SELL 交付类型 + 上游商品缓存 / 采购单 / 成交明细 三张表

ALTER TABLE `products`
  MODIFY `deliveryType` ENUM('CARD_KEY', 'POOL_QUOTA', 'MANUAL', 'AIZHP', 'CURSOR_SELL') NOT NULL DEFAULT 'CARD_KEY';

CREATE TABLE `cursor_sell_products` (
  `code` VARCHAR(64) NOT NULL,
  `title` VARCHAR(128) NOT NULL,
  `tier` VARCHAR(32) NOT NULL,
  `priceCents` INTEGER NOT NULL,
  `warrantyHours` INTEGER NULL,
  `deliveryFields` JSON NULL,
  `stock` INTEGER NOT NULL DEFAULT 0,
  `extractOnly` BOOLEAN NOT NULL DEFAULT false,
  `ondemandTeam` BOOLEAN NOT NULL DEFAULT false,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `raw` JSON NULL,
  `lastSyncAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`code`),
  INDEX `cursor_sell_products_active_tier_idx` (`active`, `tier`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cursor_sell_purchases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `idempotencyKey` VARCHAR(128) NOT NULL,
  `source` ENUM('ORDER', 'MANUAL') NOT NULL DEFAULT 'ORDER',
  `orderNo` VARCHAR(64) NULL,
  `productCode` VARCHAR(64) NOT NULL,
  `productTitle` VARCHAR(128) NOT NULL,
  `qty` INTEGER NOT NULL DEFAULT 1,
  `extractSplit` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('PENDING', 'DONE', 'MAKING', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `kind` VARCHAR(16) NULL,
  `costCents` INTEGER NULL,
  `responseEnc` TEXT NULL,
  `errorCode` VARCHAR(64) NULL,
  `failReason` VARCHAR(500) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lastAttemptAt` DATETIME(3) NULL,
  `operatorId` INTEGER NULL,
  `notifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cursor_sell_purchases_idempotencyKey_key` (`idempotencyKey`),
  INDEX `cursor_sell_purchases_orderNo_idx` (`orderNo`),
  INDEX `cursor_sell_purchases_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `cursor_sell_purchases_source_createdAt_idx` (`source`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cursor_sell_sales` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `purchaseId` INTEGER NOT NULL,
  `orderNo` VARCHAR(64) NULL,
  `cardKeyId` INTEGER NULL,
  `saleId` INTEGER NULL,
  `extractCardId` INTEGER NULL,
  `kind` VARCHAR(16) NOT NULL,
  `productCode` VARCHAR(64) NOT NULL,
  `tier` VARCHAR(32) NULL,
  `email` VARCHAR(255) NULL,
  `making` BOOLEAN NOT NULL DEFAULT false,
  `loginApprove` BOOLEAN NOT NULL DEFAULT false,
  `loginApprovedAt` DATETIME(3) NULL,
  `warrantyUntil` DATETIME(3) NULL,
  `soldAt` DATETIME(3) NULL,
  `credentialsEnc` TEXT NULL,
  `usageJson` JSON NULL,
  `usageAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cursor_sell_sales_cardKeyId_key` (`cardKeyId`),
  INDEX `cursor_sell_sales_orderNo_idx` (`orderNo`),
  INDEX `cursor_sell_sales_saleId_idx` (`saleId`),
  INDEX `cursor_sell_sales_purchaseId_idx` (`purchaseId`),
  INDEX `cursor_sell_sales_making_idx` (`making`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cursor_sell_purchases`
  ADD CONSTRAINT `cursor_sell_purchases_productCode_fkey`
    FOREIGN KEY (`productCode`) REFERENCES `cursor_sell_products`(`code`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `cursor_sell_sales`
  ADD CONSTRAINT `cursor_sell_sales_purchaseId_fkey`
    FOREIGN KEY (`purchaseId`) REFERENCES `cursor_sell_purchases`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
