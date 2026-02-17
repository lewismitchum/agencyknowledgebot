import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const db = await getDb();

  // SQLite schema introspection
  const columns = await db.all<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>(`PRAGMA table_info(users)`);

  const indexes = await db.all<any>(`PRAGMA index_list(users)`);

  return NextResponse.json({
    ok: true,
    columns,
    indexes,
  });
}
