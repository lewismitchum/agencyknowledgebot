// lib/google-sheets.ts

import { google, sheets_v4 } from "googleapis";

export type LinkedSheetTarget = {
  spreadsheetId: string;
  spreadsheetName?: string | null;
  sheetName: string;
  rangeA1?: string | null;
};

export type TableWritePlan = {
  kind: "table";
  title: string;
  columns: string[];
  rows: string[][];
};

export type UpdateWritePlan = {
  kind: "updates";
  updates: Array<{
    row: number;
    col: string;
    old: string | null;
    new: string;
    reason?: string;
  }>;
  csv_snapshot: string;
};

export type SheetWritePlan = TableWritePlan | UpdateWritePlan;

export type SheetWriteResult = {
  ok: true;
  mode: "table" | "updates";
  spreadsheetId: string;
  sheetName: string;
  rangeA1: string | null;
  message: string;
};

function clampString(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function normalizeTarget(target: LinkedSheetTarget): LinkedSheetTarget {
  const spreadsheetId = clampString(target.spreadsheetId ?? "", 500).trim();
  const spreadsheetName = clampString(target.spreadsheetName ?? "", 300).trim() || null;
  const sheetName = clampString(target.sheetName ?? "", 120).trim();
  const rangeA1 = clampString(target.rangeA1 ?? "", 120).trim() || null;

  if (!spreadsheetId) {
    throw new Error("Missing spreadsheetId.");
  }

  if (!sheetName) {
    throw new Error("Missing sheetName.");
  }

  return {
    spreadsheetId,
    spreadsheetName,
    sheetName,
    rangeA1,
  };
}

function normalizeTablePlan(plan: TableWritePlan): TableWritePlan {
  const title = clampString(plan.title ?? "Spreadsheet", 120).trim() || "Spreadsheet";

  const columns = Array.isArray(plan.columns)
    ? plan.columns.map((c) => clampString(c ?? "", 120).trim()).filter(Boolean).slice(0, 200)
    : [];

  if (!columns.length) {
    throw new Error("Table write plan is missing columns.");
  }

  const rows = Array.isArray(plan.rows)
    ? (plan.rows
        .map((row) =>
          Array.isArray(row)
            ? Array.from({ length: columns.length }, (_, i) => clampString(row?.[i] ?? "", 5000))
            : null
        )
        .filter(Boolean)
        .slice(0, 10000) as string[][])
    : [];

  return {
    kind: "table",
    title,
    columns,
    rows,
  };
}

function normalizeUpdatePlan(plan: UpdateWritePlan): UpdateWritePlan {
  const updates = Array.isArray(plan.updates)
    ? plan.updates
        .map((u) => ({
          row: Number(u?.row),
          col: clampString(u?.col ?? "", 50).trim(),
          old: u?.old == null ? null : clampString(String(u.old), 5000),
          new: clampString(u?.new ?? "", 5000).trim(),
          reason: clampString(u?.reason ?? "", 300).trim() || undefined,
        }))
        .filter((u) => Number.isFinite(u.row) && u.row >= 1 && u.col && u.new)
        .slice(0, 500)
    : [];

  if (!updates.length) {
    throw new Error("Update write plan has no valid updates.");
  }

  return {
    kind: "updates",
    updates,
    csv_snapshot: clampString(plan.csv_snapshot ?? "", 200000),
  };
}

export function normalizeSheetWritePlan(plan: SheetWritePlan): SheetWritePlan {
  if (!plan || typeof plan !== "object") {
    throw new Error("Missing sheet write plan.");
  }

  if (plan.kind === "table") return normalizeTablePlan(plan);
  if (plan.kind === "updates") return normalizeUpdatePlan(plan);

  throw new Error("Invalid sheet write plan kind.");
}

function getSheetsAuth() {
  const clientEmail = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "").trim();
  const privateKeyRaw = String(process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").trim();

  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "Missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY."
    );
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = getSheetsAuth();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function escapeSheetName(name: string) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetterToNumber(col: string) {
  const s = String(col || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;

  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

function numberToColumnLetter(n: number) {
  let x = Math.max(1, Math.floor(n));
  let out = "";
  while (x > 0) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsvSnapshot(csv: string) {
  const lines = String(csv || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.length > 0);

  if (!lines.length) return { headers: [] as string[], hasHeader: false };

  const headers = parseCsvLine(lines[0]).map((x) => String(x ?? "").trim());
  const hasHeader = headers.some(Boolean);

  return { headers, hasHeader };
}

function resolveUpdateCellAddress(csvSnapshot: string, row: number, col: string) {
  const rowNum = Math.max(1, Math.floor(Number(row)));
  const colRaw = String(col || "").trim();

  const colAsLetter = columnLetterToNumber(colRaw);
  if (colAsLetter) {
    return `${numberToColumnLetter(colAsLetter)}${rowNum}`;
  }

  const parsed = parseCsvSnapshot(csvSnapshot);
  if (parsed.hasHeader) {
    const idx = parsed.headers.findIndex((h) => h.trim().toLowerCase() === colRaw.toLowerCase());
    if (idx >= 0) {
      return `${numberToColumnLetter(idx + 1)}${rowNum}`;
    }
  }

  throw new Error(`Could not resolve update column "${colRaw}" to a sheet column.`);
}

async function ensureSheetExists(args: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetName: string;
}) {
  const meta = await args.sheets.spreadsheets.get({
    spreadsheetId: args.spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const existing = meta.data.sheets?.find(
    (s) => String(s.properties?.title ?? "") === args.sheetName
  );

  if (existing?.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }

  const addResp = await args.sheets.spreadsheets.batchUpdate({
    spreadsheetId: args.spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: args.sheetName,
            },
          },
        },
      ],
    },
  });

  const addedSheetId =
    addResp.data.replies?.[0]?.addSheet?.properties?.sheetId;

  if (addedSheetId == null) {
    throw new Error(`Failed to create sheet "${args.sheetName}".`);
  }

  return addedSheetId;
}

async function clearAndWriteTable(args: {
  sheets: sheets_v4.Sheets;
  target: LinkedSheetTarget;
  plan: TableWritePlan;
}) {
  const { sheets, target, plan } = args;

  await ensureSheetExists({
    sheets,
    spreadsheetId: target.spreadsheetId,
    sheetName: target.sheetName,
  });

  const values = [plan.columns, ...plan.rows];
  const startRange = target.rangeA1
    ? `${escapeSheetName(target.sheetName)}!${target.rangeA1}`
    : `${escapeSheetName(target.sheetName)}!A1`;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: target.spreadsheetId,
    range: `${escapeSheetName(target.sheetName)}`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: target.spreadsheetId,
    range: startRange,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });

  return {
    rangeA1: target.rangeA1 || "A1",
    rowCount: plan.rows.length + 1,
    columnCount: plan.columns.length,
  };
}

async function writeUpdates(args: {
  sheets: sheets_v4.Sheets;
  target: LinkedSheetTarget;
  plan: UpdateWritePlan;
}) {
  const { sheets, target, plan } = args;

  await ensureSheetExists({
    sheets,
    spreadsheetId: target.spreadsheetId,
    sheetName: target.sheetName,
  });

  const data = plan.updates.map((u) => {
    const cell = resolveUpdateCellAddress(plan.csv_snapshot, u.row, u.col);
    return {
      range: `${escapeSheetName(target.sheetName)}!${cell}`,
      values: [[u.new]],
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: target.spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });

  return {
    rangeA1: target.rangeA1 || null,
    updateCount: plan.updates.length,
  };
}

export async function writeProposalToGoogleSheet(args: {
  target: LinkedSheetTarget;
  plan: SheetWritePlan;
}): Promise<SheetWriteResult> {
  const target = normalizeTarget(args.target);
  const plan = normalizeSheetWritePlan(args.plan);
  const sheets = await getSheetsClient();

  if (plan.kind === "table") {
    const result = await clearAndWriteTable({
      sheets,
      target,
      plan,
    });

    return {
      ok: true,
      mode: "table",
      spreadsheetId: target.spreadsheetId,
      sheetName: target.sheetName,
      rangeA1: result.rangeA1,
      message: `Wrote ${result.rowCount} rows across ${result.columnCount} columns to ${target.sheetName}.`,
    };
  }

  const result = await writeUpdates({
    sheets,
    target,
    plan,
  });

  return {
    ok: true,
    mode: "updates",
    spreadsheetId: target.spreadsheetId,
    sheetName: target.sheetName,
    rangeA1: result.rangeA1,
    message: `Patched ${result.updateCount} cells in ${target.sheetName}.`,
  };
}