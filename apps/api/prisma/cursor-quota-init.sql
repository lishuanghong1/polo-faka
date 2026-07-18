USE polo_faka;

CREATE TABLE IF NOT EXISTS cursor_quota_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NULL,
  emailPassword VARCHAR(255) NULL,
  tokenEnc TEXT NULL,
  purchasedAt DATETIME(3) NULL,
  purchasePrice DECIMAL(12, 2) NOT NULL DEFAULT 0,
  pricePerUsd DECIMAL(12, 4) NOT NULL DEFAULT 1,
  membershipType VARCHAR(32) NULL,
  isUnlimited TINYINT(1) NOT NULL DEFAULT 0,
  planUsedCents INT NULL,
  planLimitCents INT NULL,
  planPercent DOUBLE NULL,
  onDemandCents INT NULL,
  totalCostCents INT NULL,
  billingCycleStart DATETIME(3) NULL,
  billingCycleEnd DATETIME(3) NULL,
  accountStatus ENUM('UNKNOWN','HEALTHY','LOW_QUOTA','EXHAUSTED','TOKEN_INVALID') NOT NULL DEFAULT 'UNKNOWN',
  lastCheckedAt DATETIME(3) NULL,
  lastCheckError VARCHAR(500) NULL,
  note VARCHAR(500) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL,
  UNIQUE KEY cursor_quota_accounts_email_key (email),
  KEY cursor_quota_accounts_accountStatus_idx (accountStatus),
  KEY cursor_quota_accounts_purchasedAt_idx (purchasedAt),
  KEY cursor_quota_accounts_createdAt_idx (createdAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cursor_quota_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  accountId INT NOT NULL,
  usedCents INT NOT NULL DEFAULT 0,
  totalCostCents INT NOT NULL DEFAULT 0,
  percent DOUBLE NULL,
  membershipType VARCHAR(32) NULL,
  checkedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY cursor_quota_snapshots_accountId_checkedAt_idx (accountId, checkedAt),
  CONSTRAINT cursor_quota_snapshots_accountId_fkey
    FOREIGN KEY (accountId) REFERENCES cursor_quota_accounts(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
