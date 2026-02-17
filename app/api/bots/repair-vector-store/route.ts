// app/api/bots/repair-vector-store/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireOwner } from "@/lib/authz";

export const runtime = "nodejs";

function json(status: number, data: any) {
  return NextResponse.json(data, { status });
}

function makeId(prefix: string) {
  const c: any = (globalThis as any).crypto;
  const uuid =
    c && typeof c.randomUUID === "function"
      ? c.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

async function tryCreateVectorStore(name: string) {
  try {
    const vs = await openai.vectorStores.create({ name });
    return { ok: true as const, id: vs.id, error: null as string | null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.error("VECTOR_STORE_CREATE_FAILED", msg);
    return { ok: false as const, id: null as string | null, error: msg };
  }
}

export async function POST(req: NextRequest) {
  try {
    // ✅ Owner-only (avoids random members modifying)
    await requireOwner(req);

    const body = await req.json().catch(() => ({}));
    const providedName =
      body && typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    const name = providedName ?? makeId("vs");

    const created = await tryCreateVectorStore(name);
    if (!created.ok) {
      return json(500, { error: "VECTOR_STORE_CREATE_FAILED", message: created.error });
    }

    const db: Db = await getDb();
    // adjust to your DB API; assuming vectorStores.create accepts { id, name }
    const vs = await (db as any).vectorStores.create({ id: created.id!, name });

    return json(200, { ok: true, vectorStore: vs });
  } catch (e: any) {
    console.error("POST_REPAIR_VECTOR_STORE_ERROR", e);
    return json(500, { error: "internal_error", message: String(e?.message ?? e) });
  }
}
