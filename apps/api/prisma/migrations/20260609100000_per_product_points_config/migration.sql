-- Per-product points configuration (返积分 / 积分支付 开关，按商品独立配置)

ALTER TABLE `products`
  ADD COLUMN `pointsAwardEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `pointsPayEnabled`   BOOLEAN NOT NULL DEFAULT FALSE;

-- 历史商品：CARD_KEY 类商品默认放开积分支付，其它（号池/人工）保持禁用，以保留原有「只有卡密支持积分支付」的行为
UPDATE `products`
   SET `pointsPayEnabled` = TRUE
 WHERE `deliveryType` = 'CARD_KEY';

ALTER TABLE `forge_products`
  ADD COLUMN `pointsAwardEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `pointsPayEnabled`   BOOLEAN NOT NULL DEFAULT TRUE;
