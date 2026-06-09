-- 每商品的返积分倍率（null = 走全局默认 10%）

ALTER TABLE `products`
  ADD COLUMN `pointsAwardRate` DECIMAL(5, 4) NULL;

ALTER TABLE `forge_products`
  ADD COLUMN `pointsAwardRate` DECIMAL(5, 4) NULL;
