// lib/db.ts
import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error("Missing TURSO_DATABASE_URL");
  if (!authToken) throw new Error("Missing TURSO_AUTH_TOKEN");

  _client = createClient({
    url,
    authToken,
  });

  return _client;
}

export type RunResult = { changes: number; lastID?: string | number };

export type Db = {
  run: (sql: string, ...args: any[]) => Promise<RunResult>;
  get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, ...args: any[]) => Promise<T[]>;
  exec: (sql: string) => Promise<void>;
};

function stripSqlComments(sql: string) {
  // Basic stripping for schema bootstrap blocks. Avoids breaking on semicolons inside comments.
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

function splitSqlStatements(sql: string): string[] {
  // Minimal splitter: handles semicolons inside single/double quoted strings.
  const s = stripSqlComments(sql);
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : "";

    if (ch === "'" && !inDouble && prev !== "\\") inSingle = !inSingle;
    if (ch === `"` && !inSingle && prev !== "\\") inDouble = !inDouble;

    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = "";
      continue;
    }

    cur += ch;
  }

  const last = cur.trim();
  if (last) out.push(last);

  return out;
}

export async function getDb(): Promise<Db> {
  const client = getClient();

  return {
    async run(sql: string, ...args: any[]) {
      const rs = await client.execute({ sql, args });
      return { changes: rs.rowsAffected ?? 0, lastID: rs.lastInsertRowid as any };
    },

    async get<T = any>(sql: string, ...args: any[]) {
      const rs = await client.execute({ sql, args });
      return (rs.rows?.[0] as T) ?? undefined;
    },

    async all<T = any>(sql: string, ...args: any[]) {
      const rs = await client.execute({ sql, args });
      return (rs.rows as T[]) ?? [];
    },

    async exec(sql: string) {
      const statements = splitSqlStatements(sql);
      for (const stmt of statements) {
        await client.execute(stmt);
      }
    },
  };
}