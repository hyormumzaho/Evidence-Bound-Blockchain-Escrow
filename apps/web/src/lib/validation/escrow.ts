import { z } from "zod";
import { ethAddressSchema } from "./auth";

export const confirmEscrowBodySchema = z.object({
  variant: z.enum(["individual", "manifest", "merkle"]),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  agreement: z.object({
    schema: z.literal("evidencebound.agreement.v1"),
    agreementNonce: z.string().min(1),
    amount: z.string().regex(/^\d+$/),
    arbitrator: ethAddressSchema,
    chainId: z.string().regex(/^\d+$/),
    deliveryDeadline: z.string().regex(/^\d+$/),
    escrowContract: ethAddressSchema,
    maxRevisions: z.literal("1"),
    payer: ethAddressSchema,
    provider: ethAddressSchema,
    reviewPeriod: z.string().regex(/^\d+$/),
    revisionDeliveryWindow: z.string().regex(/^\d+$/),
    templateHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    token: ethAddressSchema,
  }),
  stagingRowId: z.number().int().positive().optional(),
});

export type ConfirmEscrowBody = z.infer<typeof confirmEscrowBodySchema>;
