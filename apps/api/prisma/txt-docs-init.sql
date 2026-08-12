-- TXT 文本库建表脚本
--
-- prisma/migrations 目录已与 schema 脱节（warehouse_accounts / cursor_sub_accounts /
-- cursor_quota_accounts 等表均无对应迁移），在生产执行 `prisma migrate dev` 会被判定为
-- drift 并提议重置数据库。因此新表沿用 cursor-quota-init.sql 的做法：手动执行本脚本。
--
-- 用法：mysql -u root -p polo_faka < prisma/txt-docs-init.sql
-- 本地开发也可以直接 `pnpm prisma:push`（db push 不会碰迁移历史）。

USE polo_faka;

CREATE TABLE IF NOT EXISTS txt_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  remark VARCHAR(255) NULL,
  sort INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL,
  UNIQUE KEY txt_categories_name_key (name)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS txt_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoryId INT NOT NULL,
  title VARCHAR(128) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  preview VARCHAR(200) NOT NULL DEFAULT '',
  filename VARCHAR(255) NULL,
  size INT NOT NULL DEFAULT 0,
  remark VARCHAR(255) NULL,
  sort INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL,
  KEY txt_documents_categoryId_sort_idx (categoryId, sort),
  KEY txt_documents_categoryId_createdAt_idx (categoryId, createdAt),
  CONSTRAINT txt_documents_categoryId_fkey
    FOREIGN KEY (categoryId) REFERENCES txt_categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
