import { MAX_REVISIONS, SCHEMAS, type AgreementDocument, type Hex } from "@evidencebound/shared";
import { canonicalizeJson } from "./canonicalize.js";
import { keccak256Utf8 } from "./hash.js";
import { assertAddress, assertBytes32, decimalString } from "./hex.js";

export interface AgreementInput {
  agreementNonce: string;
  amount: number | bigint | string;
  arbitrator: string;
  chainId: number | bigint | string;
  deliveryDeadline: number | bigint | string;
  escrowContract: string;
  payer: string;
  provider: string;
  reviewPeriod: number | bigint | string;
  revisionDeliveryWindow: number | bigint | string;
  templateHash: Hex;
  token: string;
  maxRevisions?: number | bigint | string;
}

function assertDistinctParticipants(payer: string, provider: string, arbitrator: string): void {
  if (payer === provider || payer === arbitrator || provider === arbitrator) {
    throw new Error("payer, provider, and arbitrator must be distinct");
  }
}

export function buildAgreement(input: AgreementInput): AgreementDocument {
  if (typeof input.agreementNonce !== "string" || input.agreementNonce.length === 0) {
    throw new Error("agreementNonce must be a non-empty string");
  }

  const maxRevisions = decimalString(input.maxRevisions ?? MAX_REVISIONS, "maxRevisions");
  if (maxRevisions !== String(MAX_REVISIONS)) {
    throw new Error(`maxRevisions must be ${MAX_REVISIONS} (contract constant is authoritative)`);
  }

  const payer = assertAddress(input.payer, "payer");
  const provider = assertAddress(input.provider, "provider");
  const arbitrator = assertAddress(input.arbitrator, "arbitrator");
  assertDistinctParticipants(payer, provider, arbitrator);

  const amount = decimalString(input.amount, "amount");
  if (amount === "0") {
    throw new Error("amount must be non-zero");
  }

  return {
    schema: SCHEMAS.agreement,
    agreementNonce: input.agreementNonce,
    amount,
    arbitrator,
    chainId: decimalString(input.chainId, "chainId"),
    deliveryDeadline: decimalString(input.deliveryDeadline, "deliveryDeadline"),
    escrowContract: assertAddress(input.escrowContract, "escrowContract"),
    maxRevisions,
    payer,
    provider,
    reviewPeriod: decimalString(input.reviewPeriod, "reviewPeriod"),
    revisionDeliveryWindow: decimalString(input.revisionDeliveryWindow, "revisionDeliveryWindow"),
    templateHash: assertBytes32(input.templateHash, "templateHash"),
    token: assertAddress(input.token, "token"),
  };
}

export function canonicalizeAgreement(doc: AgreementDocument): string {
  if (doc.schema !== SCHEMAS.agreement) {
    throw new Error(`Unexpected agreement schema: ${doc.schema}`);
  }
  return canonicalizeJson(doc);
}

/** keccak256 of RFC 8785 canonical agreement UTF-8 bytes. */
export function hashAgreement(doc: AgreementDocument): Hex {
  return keccak256Utf8(canonicalizeAgreement(doc));
}
