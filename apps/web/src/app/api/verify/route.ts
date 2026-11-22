import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { verifyIndependentPackage } from "@/lib/evidence/independent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EXPORT_CHARS = 2_000_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      exportText?: string;
      fileBase64?: string;
      itemIndex?: number;
    };
    if (!body.exportText || body.exportText.length > MAX_EXPORT_CHARS) {
      return jsonError("Paste an evidence export JSON package", 400);
    }
    let fileBytes: Uint8Array | undefined;
    if (body.fileBase64) {
      const bytes = Buffer.from(body.fileBase64, "base64");
      if (bytes.byteLength > MAX_FILE_BYTES) return jsonError("File exceeds 10 MiB", 400);
      fileBytes = new Uint8Array(bytes);
    }
    const verdict = await verifyIndependentPackage({
      exportText: body.exportText,
      fileBytes,
      itemIndex: body.itemIndex,
    });
    return NextResponse.json(verdict);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Verification failed", 400);
  }
}
