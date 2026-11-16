import { NextResponse } from "next/server";
import { getChainStatus } from "@/lib/chain/status";

export const dynamic = "force-dynamic";

/** Public read-only chain health. No private keys. */
export async function GET() {
  const status = await getChainStatus();
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
