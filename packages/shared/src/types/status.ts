import type { EvidenceStatusCode, OffchainStatusCode } from "../constants.js";

export type VerifyResult =
  | { ok: true; status: typeof import("../constants.js").EvidenceStatus.Valid }
  | { ok: false; status: EvidenceStatusCode | OffchainStatusCode; message: string };
