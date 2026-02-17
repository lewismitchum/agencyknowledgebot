import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  const k = process.env.OPENAI_API_KEY || "";
  return NextResponse.json({
    hasKey: Boolean(k),
    prefix: k.slice(0, 7),
    len: k.length,
  });
}
