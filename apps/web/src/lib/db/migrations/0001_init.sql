CREATE TABLE IF NOT EXISTS `escrows` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `chain_id` integer NOT NULL,
  `variant` text NOT NULL,
  `contract_address` text NOT NULL,
  `escrow_id` integer,
  `payer` text NOT NULL,
  `provider` text NOT NULL,
  `arbitrator` text NOT NULL,
  `agreement_hash` text DEFAULT '' NOT NULL,
  `template_hash` text DEFAULT '' NOT NULL,
  `created_tx` text,
  `created_block` integer,
  `state_cache` text,
  `is_staging` integer DEFAULT true NOT NULL,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `escrows_chain_contract_escrow` ON `escrows` (`chain_id`,`contract_address`,`escrow_id`);
CREATE INDEX IF NOT EXISTS `idx_escrows_participants` ON `escrows` (`payer`,`provider`,`arbitrator`);

CREATE TABLE IF NOT EXISTS `agreements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `escrow_row_id` integer NOT NULL,
  `canonical_json` text NOT NULL,
  `agreement_hash` text NOT NULL,
  FOREIGN KEY (`escrow_row_id`) REFERENCES `escrows`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `agreements_escrow_row` ON `agreements` (`escrow_row_id`);

CREATE TABLE IF NOT EXISTS `evidence_deliveries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `escrow_row_id` integer NOT NULL,
  `delivery_version` integer NOT NULL,
  `manifest_hash` text NOT NULL,
  `export_json` text NOT NULL,
  `submit_tx` text,
  FOREIGN KEY (`escrow_row_id`) REFERENCES `escrows`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `deliveries_escrow_version` ON `evidence_deliveries` (`escrow_row_id`,`delivery_version`);

CREATE TABLE IF NOT EXISTS `evidence_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `delivery_id` integer NOT NULL,
  `item_index` integer NOT NULL,
  `evidence_type` text NOT NULL,
  `content_hash` text NOT NULL,
  `salt` text NOT NULL,
  `byte_length` integer NOT NULL,
  `storage_key` text NOT NULL,
  `original_filename` text,
  FOREIGN KEY (`delivery_id`) REFERENCES `evidence_deliveries`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS `evidence_items_storage_key_unique` ON `evidence_items` (`storage_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `items_delivery_index` ON `evidence_items` (`delivery_id`,`item_index`);

CREATE TABLE IF NOT EXISTS `files` (
  `storage_key` text PRIMARY KEY NOT NULL,
  `escrow_row_id` integer NOT NULL,
  `absolute_relpath` text NOT NULL,
  `byte_length` integer NOT NULL,
  `content_hash` text NOT NULL,
  `original_filename` text,
  `created_at` integer NOT NULL,
  `owner_address` text NOT NULL,
  FOREIGN KEY (`escrow_row_id`) REFERENCES `escrows`(`id`) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `idx_files_owner` ON `files` (`owner_address`);
CREATE INDEX IF NOT EXISTS `idx_files_escrow` ON `files` (`escrow_row_id`);

CREATE TABLE IF NOT EXISTS `auth_nonces` (
  `address` text NOT NULL,
  `nonce` text NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `auth_nonces_pk` ON `auth_nonces` (`address`,`nonce`);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `address` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_sessions_address` ON `sessions` (`address`);
