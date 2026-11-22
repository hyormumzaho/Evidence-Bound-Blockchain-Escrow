import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resultsPath(): string {
  const candidates = [
    join(process.cwd(), "experiments/results/latest.json"),
    join(process.cwd(), "../../experiments/results/latest.json"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[1]!;
}

export async function GET() {
  const path = resultsPath();
  if (!existsSync(path)) {
    return NextResponse.json({
      available: false,
      command: "pnpm experiment:small",
      message: "No measurement file yet. Run the headless suite, then refresh this page.",
    });
  }
  const document = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return NextResponse.json({ available: true, path: "experiments/results/latest.json", document });
}
