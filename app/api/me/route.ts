// app/api/me/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agency = (await db.get(
      `SELECT id, name, email, plan
       FROM agencies
       WHERE id = ?
       LIMIT 1`,
      ctx.agencyId
    )) as { id: string; name: string | null; email: string | null; plan: string | null } | undefined;

    const user = (await db.get(
      `SELECT id, email, email_verified, role, status
       FROM users
       WHERE agency_id = ? AND id = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId
    )) as
      | {
          id: string;
          email: string;
          email_verified: number | null;
          role: string | null;
          status: string | null;
        }
      | undefined;

    return Response.json({
      ok: true,
      agency: {
        id: agency?.id ?? ctx.agencyId,
        name: agency?.name ?? null,
        email: agency?.email ?? null,
        plan: agency?.plan ?? (ctx.plan ?? "free"),
      },
      user: {
        id: user?.id ?? ctx.userId,
        email: user?.email ?? ctx.agencyEmail, // fallback
        email_verified: Number(user?.email_verified ?? 0),
        role: user?.role ?? "member",
        status: user?.status ?? "active",
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}