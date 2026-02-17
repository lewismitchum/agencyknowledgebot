import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const db = await getDb();

  await db.exec(`
    create table if not exists conversations (
      id text primary key,
      user_id text not null,
      bot_id text not null,
      summary text not null default '',
      message_count integer not null default 0,
      created_at integer not null,
      updated_at integer not null
    );
  `);

  return NextResponse.json({ ok: true });
}
