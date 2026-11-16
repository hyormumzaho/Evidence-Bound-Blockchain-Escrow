import { buildAgreement, canonicalizeAgreement, hashAgreement } from "@evidencebound/evidence";
import type { AgreementDocument } from "@evidencebound/shared";
import type { Address, Hex } from "viem";
import { TEMPLATE_HASH } from "./template";

export type BuildCreateAgreementInput = {
  agreementNonce: string;
  amountBaseUnits: bigint;
  arbitrator: Address;
  chainId: number;
  deliveryDeadline: number;
  escrowContract: Address;
  payer: Address;
  provider: Address;
  reviewPeriod: number;
  revisionDeliveryWindow: number;
  token: Address;
  templateHash?: Hex;
};

export function buildCreateAgreement(input: BuildCreateAgreementInput): {
  document: AgreementDocument;
  canonicalJson: string;
  agreementHash: Hex;
  templateHash: Hex;
} {
  const templateHash = input.templateHash ?? TEMPLATE_HASH;
  const document = buildAgreement({
    agreementNonce: input.agreementNonce,
    amount: input.amountBaseUnits,
    arbitrator: input.arbitrator,
    chainId: input.chainId,
    deliveryDeadline: input.deliveryDeadline,
    escrowContract: input.escrowContract,
    payer: input.payer,
    provider: input.provider,
    reviewPeriod: input.reviewPeriod,
    revisionDeliveryWindow: input.revisionDeliveryWindow,
    templateHash,
    token: input.token,
  });
  return {
    document,
    canonicalJson: canonicalizeAgreement(document),
    agreementHash: hashAgreement(document),
    templateHash,
  };
}
