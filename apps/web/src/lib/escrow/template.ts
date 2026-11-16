import { keccak256, toBytes } from "viem";

/** Matches Foundry demos: keccak256("website-milestone-v1"). */
export const TEMPLATE_ID = "website-milestone-v1";
export const TEMPLATE_HASH = keccak256(toBytes(TEMPLATE_ID));
