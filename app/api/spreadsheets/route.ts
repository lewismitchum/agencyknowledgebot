// app/api/spreadsheets/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { hasFeature, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Upsell = { code?: string; message?: string };

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(
      `SELECT plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { plan: string | null } | undefined;

    const plan = normalizePlan(agency?.plan ?? (ctx as any)?.plan ?? "free");

    // feature flag key: "spreadsheets"
    const enabled = hasFeature(plan, "spreadsheets");

    const upsell: Upsell | null = enabled
      ? null
      : {
          code: "UPSELL_SPREADSHEETS",
          message: "Upgrade to unlock spreadsheet AI extraction + updates.",
        };

    return NextResponse.json({ ok: enabled, plan, upsell });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (code === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_NOT_ACTIVE" }, { status: 403 });
    }

    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}