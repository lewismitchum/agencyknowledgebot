// app/api/dev/extract/route.ts
import type { NextRequest } from "next/server";
import { POST as ExtractPOST } from "@/app/api/extract/route";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return ExtractPOST(req);
}
