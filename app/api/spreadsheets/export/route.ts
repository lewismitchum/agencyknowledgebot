// app/api/spreadsheets/export/route.ts
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireActiveMember } from "@/lib/authz";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";

export const runtime = "nodejs";

type ExportBody = {
  title?: string;
  columns?: string[];
  rows?: string[][];
};

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function safeFilename(s: string) {
  const base = clampString(s || "spreadsheet", 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "spreadsheet"}.xlsx`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(plan);

    const gate = requireFeature(planKey, "spreadsheets");
    if (!gate.ok) return Response.json(gate.body, { status: gate.status });

    const body = (await req.json().catch(() => null)) as ExportBody | null;

    const title = clampString(body?.title ?? "Spreadsheet", 120).trim() || "Spreadsheet";
    const columns = Array.isArray(body?.columns)
      ? body.columns.map((c) => clampString(c ?? "", 120).trim()).filter(Boolean).slice(0, 200)
      : [];

    const rows = Array.isArray(body?.rows)
      ? body.rows
          .map((row) =>
            Array.isArray(row) ? row.map((cell) => clampString(cell ?? "", 5000)) : null
          )
          .filter(Boolean)
          .slice(0, 10000)
      : [];

    if (!columns.length) {
      return Response.json({ ok: false, error: "MISSING_COLUMNS" }, { status: 400 });
    }

    const normalizedRows = rows.map((row) => {
      const next = Array.from({ length: columns.length }, (_, i) => String((row as string[])?.[i] ?? ""));
      return next;
    });

    const aoa = [columns, ...normalizedRows];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws["!cols"] = columns.map((col, idx) => {
      const maxCell = normalizedRows.reduce((max, row) => Math.max(max, String(row[idx] ?? "").length), col.length);
      return { wch: Math.min(Math.max(maxCell + 2, 12), 40) };
    });

    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
    }) as Buffer;

    const filename = safeFilename(title);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("SPREADSHEETS_EXPORT_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}