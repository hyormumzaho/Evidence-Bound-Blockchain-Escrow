import { z } from "zod";
import { ethAddressSchema } from "./auth";

export const stagingBodySchema = z.object({
  chainId: z.number().int().positive().default(31337),
  variant: z.enum(["individual", "merkle"]),
  contractAddress: ethAddressSchema,
  payer: ethAddressSchema,
  provider: ethAddressSchema,
  arbitrator: ethAddressSchema,
});

export const uploadMetaSchema = z.object({
  escrowRowId: z.coerce.number().int().positive(),
  expectedContentHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  originalFilename: z.string().max(255).optional(),
});
