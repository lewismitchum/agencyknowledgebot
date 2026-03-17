// app/api/email/disconnect/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ColumnRow = {
  name?: string;
};

function hasColumn(cols: ColumnRow[], name: string) {
  return cols.some((c) => String(c?.name || "").toLowerCase() === name.toLowerCase());
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);

    const gate = requireFeature(planKey, "email");
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: "Upgrade required" }, { status: 403 });
    }

    const tables = await db.all<{ name?: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='email_accounts'"
    );

    if (!Array.isArray(tables) || tables.length === 0) {
      const res = NextResponse.json({ ok: true, disconnected: true });
      res.cookies.set("email_oauth_state", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      return res;
    }

    const cols = await db.all<ColumnRow>("PRAGMA table_info(email_accounts)");
    const where: string[] = [];
    const args: any[] = [];

    if (hasColumn(cols, "agency_id")) {
      where.push("agency_id = ?");
      args.push(ctx.agencyId);
    }

    if (hasColumn(cols, "user_id")) {
      where.push("user_id = ?");
      args.push(ctx.userId);
    }

    if (hasColumn(cols, "provider")) {
      where.push("LOWER(provider) = ?");
      args.push("google");
    }

    const sql =
      where.length > 0
        ? `DELETE FROM email_accounts WHERE ${where.join(" AND ")}`
        : `DELETE FROM email_accounts`;

    await db.run(sql, args);

    const res = NextResponse.json({ ok: true, disconnected: true });
    res.cookies.set("email_oauth_state", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (msg === "FORBIDDEN_NOT_ACTIVE") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "Server error", message: msg }, { status: 500 });
  }
}