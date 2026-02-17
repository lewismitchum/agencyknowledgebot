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

type RunResult = { changes: number; lastID?: string | number };

export type Db = {
  run: (sql: string, ...args: any[]) => Promise<{ changes: number; lastID?: string | number }>;
  get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, ...args: any[]) => Promise<T[]>;
  exec: (sql: string) => Promise<void>;
};

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
      const parts = sql.split(";").map(s => s.trim()).filter(Boolean);
      for (const part of parts) await client.execute(part);
    },
  };
}
