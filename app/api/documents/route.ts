// app/api/documents/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, hasFeature, normalizePlan } from "@/lib/plans";
import { ensureUsageDailySchema, incrementUsage } from "@/lib/usage";
import { enforceDailyUploads, getAgencyPlan } from "@/lib/enforcement";

export const runtime = "nodejs";

async function getFallbackBotId(db: Db, agencyId: string, userId: string) {
  const agencyBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId
  )) as { id: string } | undefined;

  if (agencyBot?.id) return agencyBot.id;

  const userBot = (await db.get(
    `SELECT id
     FROM bots
     WHERE agency_id = ? AND owner_user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    agencyId,
    userId
  )) as { id: string } | undefined;

  return userBot?.id ?? null;
}

async function assertBotAccess(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, agency_id, owner_user_id
     FROM bots
     WHERE id = ?
     LIMIT 1`,
    args.bot_id
  )) as { id: string; agency_id: string; owner_user_id: string | null } | undefined;

  if (!bot?.id) throw new Error("BOT_NOT_FOUND");
  if (bot.agency_id !== args.agency_id) throw new Error("FORBIDDEN_BOT");
  if (bot.owner_user_id && bot.owner_user_id !== args.user_id) throw new Error("FORBIDDEN_BOT");
}

async function getAgencyTimezone(db: Db, agencyId: string) {
  const row = (await db.get(`SELECT timezone FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { timezone?: string | null }
    | undefined;

  const tz = String(row?.timezone ?? "").trim();
  return tz || "America/Chicago";
}

function ymdInTz(tz: string) {
  // en-CA -> YYYY-MM-DD
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

function maxBytesForPlan(plan: string): number {
  const p = normalizePlan(plan);
  if (p === "free") return 25 * 1024 * 1024; // 25MB
  if (p === "starter") return 25 * 1024 * 1024; // 25MB
  if (p === "pro") return 100 * 1024 * 1024; // 100MB
  if (p === "enterprise") return 250 * 1024 * 1024; // 250MB
  return 500 * 1024 * 1024; // corporation
}

function classifyMime(mime: string): "doc" | "image" | "video" | "other" {
  const m = String(mime || "").toLowerCase().trim();
  if (!m) return "other";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/")) return "doc";
  if (m === "application/pdf") return "doc";
  if (m === "application/msword") return "doc";
  if (m.startsWith("application/vnd.openxmlformats-officedocument.")) return "doc";
  if (m.startsWith("application/vnd.ms-")) return "doc";
  if (m === "application/rtf") return "doc";
  if (m === "application/json") return "doc";
  if (m === "application/xml" || m === "text/xml") return "doc";
  if (m === "application/octet-stream") return "other";
  return "other";
}

function pickFilesFromFormData(formData: FormData): File[] {
  const keys = ["file", "files", "upload", "uploads", "document", "documents"];
  const out: File[] = [];

  for (const k of keys) {
    const vals = formData.getAll(k);
    for (const v of vals) {
      if (v && typeof v === "object" && "arrayBuffer" in (v as any) && "size" in (v as any)) {
        out.push(v as File);
      }
    }
    if (out.length) break;
  }

  if (!out.length) {
    for (const v of formData.values()) {
      if (v && typeof v === "object" && "arrayBuffer" in (v as any) && "size" in (v as any)) {
        out.push(v as File);
      }
    }
  }

  return out;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const url = new URL(req.url);
    let bot_id = String(url.searchParams.get("bot_id") || "").trim();

    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "NO_BOTS" }, { status: 404 });
      }
      bot_id = fallback;
    }

    await assertBotAccess(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    const documents = await db.all(
      `SELECT id, title, openai_file_id, created_at
       FROM documents
       WHERE agency_id = ? AND bot_id = ?
       ORDER BY created_at DESC`,
      ctx.agencyId,
      bot_id
    );

    return Response.json({ ok: true, bot_id, documents: documents ?? [] });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    const msg = String(err?.message ?? err);
    if (msg === "BOT_NOT_FOUND") return Response.json({ ok: false, error: "BOT_NOT_FOUND" }, { status: 404 });
    if (msg === "FORBIDDEN_BOT") return Response.json({ ok: false, error: "FORBIDDEN_BOT" }, { status: 403 });

    console.error("DOCUMENTS_GET_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);
    await ensureUsageDailySchema(db);

    const agencyTz = await getAgencyTimezone(db, ctx.agencyId);
    const dateKey = ymdInTz(agencyTz);

    // Source of truth plan from DB
    const plan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const limits = getPlanLimits(plan);

    const allowMultimedia = hasFeature(plan, "multimedia");
    const allowImages = allowMultimedia;
    const allowVideo = allowMultimedia;
    const allowOtherBinary = allowMultimedia;
    const maxBytes = maxBytesForPlan(plan);

    // Compatibility shim: accept multipart FormData and forward to /api/upload server-side.
    const formData = await req.formData();

    // --- HARD UPLOAD ENFORCEMENT (server-side, before forwarding) ---
    const files = pickFilesFromFormData(formData);

    if (!files.length) {
      return Response.json({ ok: false, error: "NO_FILE" }, { status: 400 });
    }

    // Daily uploads gating (centralized)
    const uploadsGate = await enforceDailyUploads(db, ctx.agencyId, dateKey, plan, files.length);
    if (!uploadsGate.ok) {
      return Response.json(
        {
          ...uploadsGate.body,
          timezone: agencyTz,
        },
        { status: uploadsGate.status }
      );
    }

    // mime + size gating (match /api/upload)
    for (const f of files) {
      const size = Number((f as any).size ?? 0);
      if (!Number.isFinite(size) || size <= 0) {
        return Response.json({ ok: false, error: "INVALID_FILE" }, { status: 400 });
      }

      if (size > maxBytes) {
        return Response.json(
          {
            ok: false,
            error: "FILE_TOO_LARGE",
            message: `File exceeds size limit for plan '${plan}'.`,
            plan,
            maxBytes,
            file: { name: (f as any).name ?? null, size },
          },
          { status: 413 }
        );
      }

      const mime = String((f as any).type ?? "");
      const kind = classifyMime(mime);

      if (kind === "image" && !allowImages) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Images are not allowed on plan '${plan}'.`,
            plan,
            file: { name: (f as any).name ?? null, type: mime, kind },
          },
          { status: 403 }
        );
      }

      if (kind === "video" && !allowVideo) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Video is not allowed on plan '${plan}'.`,
            plan,
            file: { name: (f as any).name ?? null, type: mime, kind },
          },
          { status: 403 }
        );
      }

      if (kind === "other" && !allowOtherBinary) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `This file type is not allowed on plan '${plan}'.`,
            plan,
            file: { name: (f as any).name ?? null, type: mime, kind },
          },
          { status: 403 }
        );
      }

      if ((plan === "free" || plan === "starter") && kind === "other") {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `This file type is not allowed on plan '${plan}'.`,
            plan,
            file: { name: (f as any).name ?? null, type: mime, kind },
          },
          { status: 403 }
        );
      }
    }

    // Forward auth to /api/upload (do NOT redirect)
    const headers = new Headers();
    const cookie = req.headers.get("cookie");
    const authorization = req.headers.get("authorization");

    if (cookie) headers.set("cookie", cookie);
    if (authorization) headers.set("authorization", authorization);

    const target = new URL("/api/upload", req.url);

    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers,
      body: formData,
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    const text = await upstream.text();

    // ✅ Count uploads only if upstream succeeded (so failed uploads don't burn quota)
    if (upstream.status >= 200 && upstream.status < 300) {
      await incrementUsage(db, ctx.agencyId, dateKey, "uploads", files.length);
    }

    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);
    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: "Server error", message: String(err?.message ?? err) }, { status: 500 });
  }
}