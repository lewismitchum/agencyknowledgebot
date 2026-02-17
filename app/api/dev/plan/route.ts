import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePlan } from "@/lib/plans";
import { getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

const DEV_ADMIN_EMAIL = "lewismitchum7@gmail.com";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // 1) Auth (match /api/me exactly)
  const session = getSessionFromRequest(req);
  if (!session?.agencyId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) Load agency (so we can enforce DEV_ADMIN_EMAIL)
  const db = await getDb();
  const agency = await db.get<{
    id: string;
    email: string;
    plan: string | null;
  }>("SELECT id, email, plan FROM agencies WHERE id = ?", session.agencyId);

  if (!agency) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = String(agency.email ?? "").toLowerCase();
  if (email !== DEV_ADMIN_EMAIL.toLowerCase()) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3) Parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body.plan !== "string" || body.plan.trim().length === 0) {
    return Response.json({ error: "Missing or invalid `plan`" }, { status: 400 });
  }

  const normalizedPlan = normalizePlan(body.plan);

  // 4) Update plan (writes)
  // Your db wrapper almost certainly has run() for writes.
  // If it doesn't, the error will tell us the correct method name immediately.
  await db.run("UPDATE agencies SET plan = ? WHERE id = ?", normalizedPlan, agency.id);

  return Response.json({ ok: true, plan: normalizedPlan });
}
