import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const storageKey = z.string().regex(/^[a-f0-9]{32}$/);

const fileItemSchema = z.object({
  kind: z.literal("file"),
  storageKey,
  salt: hex32,
  originalFilename: z.string().max(512).optional(),
});

const urlItemSchema = z.object({
  kind: z.literal("url"),
  storageKey,
  salt: hex32,
  url: z.string().url().max(2048),
});

export const confirmEvidenceBodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  items: z.array(z.discriminatedUnion("kind", [fileItemSchema, urlItemSchema])).min(1).max(100),
});

export type ConfirmEvidenceBody = z.infer<typeof confirmEvidenceBodySchema>;
