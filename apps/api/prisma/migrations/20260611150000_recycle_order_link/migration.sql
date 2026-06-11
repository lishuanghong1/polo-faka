-- 回收申请关联订单号

ALTER TABLE `recycle_requests`
  ADD COLUMN `orderNo` VARCHAR(64) NULL;

CREATE INDEX `recycle_requests_orderNo_idx` ON `recycle_requests`(`orderNo`);
