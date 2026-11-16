import { z } from "zod";

export const ethAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

export const nonceQuerySchema = z.object({
  address: ethAddressSchema,
});

export const verifyBodySchema = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid signature"),
});
