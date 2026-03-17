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

type TableRow = {
  name?: string;
};

type ColumnRow = {
  name?: string;
};

function hasColumn(cols: ColumnRow[], name: string) {
  return cols.some((c) => String(c?.name || "").toLowerCase() === name.toLowerCase());
}

async function clearGoogleEmailAccount(db: Db, agencyId: string, userId: string) {
  const tables = await db.all<TableRow>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='email_accounts'"
  );

  if (!Array.isArray(tables) || tables.length === 0) {
    return;
  }

  let cols: ColumnRow[] = [];
  try {
    cols = await db.all<ColumnRow>("PRAGMA table_info(email_accounts)");
  } catch {
    cols = [];
  }

  const hasAgencyId = hasColumn(cols, "agency_id");
  const hasUserId = hasColumn(cols, "user_id");
  const hasProvider = hasColumn(cols, "provider");

  const attempts: Array<{ sql: string; args: any[] }> = [];

  if (hasAgencyId && hasUserId && hasProvider) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE agency_id = ? AND user_id = ? AND LOWER(provider) = ?",
      args: [agencyId, userId, "google"],
    });
  }

  if (hasAgencyId && hasUserId) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE agency_id = ? AND user_id = ?",
      args: [agencyId, userId],
    });
  }

  if (hasUserId && hasProvider) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE user_id = ? AND LOWER(provider) = ?",
      args: [userId, "google"],
    });
  }

  if (hasAgencyId && hasProvider) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE agency_id = ? AND LOWER(provider) = ?",
      args: [agencyId, "google"],
    });
  }

  if (hasUserId) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE user_id = ?",
      args: [userId],
    });
  }

  if (hasAgencyId) {
    attempts.push({
      sql: "DELETE FROM email_accounts WHERE agency_id = ?",
      args: [agencyId],
    });
  }

  attempts.push({
    sql: "DELETE FROM email_accounts",
    args: [],
  });

  for (const attempt of attempts) {
    try {
      await db.run(attempt.sql, attempt.args);
      return;
    } catch {
      // try next shape
    }
  }

  throw new Error("SQLITE_UNKNOWN");
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

    await clearGoogleEmailAccount(db, ctx.agencyId, ctx.userId);

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