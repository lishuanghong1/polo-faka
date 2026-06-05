-- Allow points payment for forge orders

ALTER TABLE `forge_orders`
  ADD COLUMN `pointsUsed` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `forge_orders`
  MODIFY `paymentMethod` ENUM('REDEEM', 'ALIPAY', 'BALANCE', 'POINTS') NOT NULL DEFAULT 'REDEEM';
