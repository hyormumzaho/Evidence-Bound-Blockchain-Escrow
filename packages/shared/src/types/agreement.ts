import type { Hex } from "./hex.js";

/**
 * Canonical agreement document.
 * Integer amounts, timestamps, durations, and chain id are decimal strings.
 * Addresses are lowercase 0x hex.
 */
export interface AgreementDocument {
  schema: "evidencebound.agreement.v1";
  agreementNonce: string;
  amount: string;
  arbitrator: string;
  chainId: string;
  deliveryDeadline: string;
  escrowContract: string;
  maxRevisions: string;
  payer: string;
  provider: string;
  reviewPeriod: string;
  revisionDeliveryWindow: string;
  templateHash: Hex;
  token: string;
}
