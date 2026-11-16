import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getSession, readSessionIdFromCookie } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = getSession(getDb(), readSessionIdFromCookie(request.headers.get("cookie")));
  if (!session) return jsonError("Unauthorized", 401);
  return NextResponse.json({ address: session.address });
}
