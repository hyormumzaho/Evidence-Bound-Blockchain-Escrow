import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getDb } from "@/lib/db/client";
import { storeUpload } from "@/lib/uploads/service";
import { uploadMetaSchema } from "@/lib/validation/uploads";
import { assertSameOrigin, jsonError, requireSession, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST multipart: file + escrowRowId (+ optional expectedContentHash, originalFilename) */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    const { address } = requireSession(request, db);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("Missing file field", 400);
    }

    const meta = uploadMetaSchema.parse({
      escrowRowId: form.get("escrowRowId"),
      expectedContentHash: form.get("expectedContentHash") || undefined,
      originalFilename: (form.get("originalFilename") as string | null) || file.name || undefined,
    });

    const buf = new Uint8Array(await file.arrayBuffer());
    const stored = storeUpload(db, {
      escrowRowId: meta.escrowRowId,
      uploader: address,
      bytes: buf,
      expectedContentHash: meta.expectedContentHash as Hex | undefined,
      originalFilename: meta.originalFilename,
    });

    return NextResponse.json({
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      byteLength: stored.byteLength,
      escrowRowId: meta.escrowRowId,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Upload failed", statusFromError(err));
  }
}
