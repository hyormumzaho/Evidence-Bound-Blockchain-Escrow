import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { loadUploadForDownload } from "@/lib/uploads/service";
import { assertSafeStorageKey } from "@/lib/storage/files";
import { jsonError, requireSession, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ storageKey: string }> };

/** GET /api/uploads/:storageKey — private download (SIWE session + participant). */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { storageKey: raw } = await ctx.params;
    // Reject traversal-looking params early
    try {
      assertSafeStorageKey(raw);
    } catch {
      return jsonError("Invalid storage key", 400);
    }

    const db = getDb();
    const { address } = requireSession(request, db);
    const file = loadUploadForDownload(db, raw, address);

    const filename = file.originalFilename?.replace(/[^\w.\- ()[\]]+/g, "_") || file.storageKey;
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(file.byteLength),
        "X-Content-Hash": file.contentHash,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Download failed", statusFromError(err));
  }
}
