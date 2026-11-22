import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** Off-chain metadata only — not payment authority. */
export const escrows = sqliteTable(
  "escrows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chainId: integer("chain_id").notNull(),
    variant: text("variant").notNull(), // individual | manifest | merkle
    contractAddress: text("contract_address").notNull(),
    /** null while staging (pre-createEscrow). */
    escrowId: integer("escrow_id"),
    payer: text("payer").notNull(),
    provider: text("provider").notNull(),
    arbitrator: text("arbitrator").notNull(),
    agreementHash: text("agreement_hash").notNull().default(""),
    templateHash: text("template_hash").notNull().default(""),
    createdTx: text("created_tx"),
    createdBlock: integer("created_block"),
    stateCache: text("state_cache"),
    isStaging: integer("is_staging", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("escrows_chain_contract_escrow").on(t.chainId, t.contractAddress, t.escrowId),
    index("idx_escrows_participants").on(t.payer, t.provider, t.arbitrator),
  ],
);

export const agreements = sqliteTable(
  "agreements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    escrowRowId: integer("escrow_row_id")
      .notNull()
      .references(() => escrows.id, { onDelete: "cascade" }),
    canonicalJson: text("canonical_json").notNull(),
    agreementHash: text("agreement_hash").notNull(),
  },
  (t) => [uniqueIndex("agreements_escrow_row").on(t.escrowRowId)],
);

export const evidenceDeliveries = sqliteTable(
  "evidence_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    escrowRowId: integer("escrow_row_id")
      .notNull()
      .references(() => escrows.id, { onDelete: "cascade" }),
    deliveryVersion: integer("delivery_version").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    exportJson: text("export_json").notNull(),
    submitTx: text("submit_tx"),
  },
  (t) => [uniqueIndex("deliveries_escrow_version").on(t.escrowRowId, t.deliveryVersion)],
);

export const evidenceItems = sqliteTable(
  "evidence_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => evidenceDeliveries.id, { onDelete: "cascade" }),
    itemIndex: integer("item_index").notNull(),
    evidenceType: text("evidence_type").notNull(),
    contentHash: text("content_hash").notNull(),
    salt: text("salt").notNull(),
    byteLength: integer("byte_length").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    originalFilename: text("original_filename"),
  },
  (t) => [uniqueIndex("items_delivery_index").on(t.deliveryId, t.itemIndex)],
);

export const files = sqliteTable(
  "files",
  {
    storageKey: text("storage_key").primaryKey(),
    escrowRowId: integer("escrow_row_id")
      .notNull()
      .references(() => escrows.id, { onDelete: "cascade" }),
    absoluteRelpath: text("absolute_relpath").notNull(),
    byteLength: integer("byte_length").notNull(),
    contentHash: text("content_hash").notNull(),
    originalFilename: text("original_filename"),
    createdAt: integer("created_at").notNull(),
    ownerAddress: text("owner_address").notNull(),
  },
  (t) => [index("idx_files_owner").on(t.ownerAddress), index("idx_files_escrow").on(t.escrowRowId)],
);

export const authNonces = sqliteTable(
  "auth_nonces",
  {
    address: text("address").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [uniqueIndex("auth_nonces_pk").on(t.address, t.nonce)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    address: text("address").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_sessions_address").on(t.address)],
);
