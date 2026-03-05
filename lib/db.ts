// lib/db.ts
import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error("Missing TURSO_DATABASE_URL");
  if (!authToken) throw new Error("Missing TURSO_AUTH_TOKEN");

  _client = createClient({ url, authToken });
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
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

function splitSqlStatements(sql: string): string[] {
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

function truncate(s: string, max = 900) {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  return str.slice(0, max) + " …(truncated)";
}

function safeArgs(args: any[]) {
  return (args || []).map((a) => {
    if (a == null) return a;
    if (typeof a === "string") return truncate(a, 140);
    if (typeof a === "number" || typeof a === "boolean") return a;
    if (a instanceof Date) return a.toISOString();
    try {
      return truncate(JSON.stringify(a), 180);
    } catch {
      return truncate(String(a), 180);
    }
  });
}

function wrapDbError(err: any, sql: string, args: any[]) {
  const msg = String(err?.message ?? err);
  const sqlSnippet = truncate(sql, 1200);
  const argSummary = safeArgs(args);

  // Always surface SQL in the thrown message so API routes return it in JSON.
  const e = new Error(
    `${msg}\n\n[SQL]\n${sqlSnippet}\n\n[ARGS]\n${JSON.stringify(argSummary)}`
  ) as any;

  e.code = err?.code ?? "DB_ERROR";
  return e;
}

export async function getDb(): Promise<Db> {
  const client = getClient();

  return {
    async run(sql: string, ...args: any[]) {
      try {
        const rs = await client.execute({ sql, args });
        return { changes: rs.rowsAffected ?? 0, lastID: rs.lastInsertRowid as any };
      } catch (err: any) {
        throw wrapDbError(err, sql, args);
      }
    },

    async get<T = any>(sql: string, ...args: any[]) {
      try {
        const rs = await client.execute({ sql, args });
        return (rs.rows?.[0] as T) ?? undefined;
      } catch (err: any) {
        throw wrapDbError(err, sql, args);
      }
    },

    async all<T = any>(sql: string, ...args: any[]) {
      try {
        const rs = await client.execute({ sql, args });
        return (rs.rows as T[]) ?? [];
      } catch (err: any) {
        throw wrapDbError(err, sql, args);
      }
    },

    async exec(sql: string) {
      const statements = splitSqlStatements(sql);
      for (const stmt of statements) {
        try {
          await client.execute(stmt);
        } catch (err: any) {
          throw wrapDbError(err, stmt, []);
        }
      }
    },
  };
}