// app/api/upload/route.ts
import type { NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { requireActiveMember } from "@/lib/authz";
import { ensureSchema } from "@/lib/schema";
import { getPlanLimits, normalizePlan } from "@/lib/plans";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET() {
  return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

type PlanKey = "free" | "starter" | "pro" | "enterprise" | "corp";

function nowIso() {
  return new Date().toISOString();
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

function asPlanKey(p: any): PlanKey {
  const s = String(p || "free").toLowerCase().trim();
  if (s === "free") return "free";
  if (s === "starter") return "starter";
  if (s === "pro") return "pro";
  if (s === "enterprise") return "enterprise";
  if (s === "corp" || s === "corporation") return "corp";
  return "free";
}

function uploadPolicy(plan: PlanKey): {
  plan: PlanKey;
  allowImages: boolean;
  allowVideo: boolean;
  allowOtherBinary: boolean;
  maxBytes: number;
} {
  if (plan === "free") {
    return {
      plan,
      allowImages: false,
      allowVideo: false,
      allowOtherBinary: false,
      maxBytes: 25 * 1024 * 1024, // 25MB
    };
  }
  if (plan === "starter") {
    return {
      plan,
      allowImages: false,
      allowVideo: false,
      allowOtherBinary: false,
      maxBytes: 25 * 1024 * 1024, // 25MB
    };
  }
  if (plan === "pro") {
    return {
      plan,
      allowImages: true,
      allowVideo: true,
      allowOtherBinary: true,
      maxBytes: 100 * 1024 * 1024, // 100MB
    };
  }
  if (plan === "enterprise") {
    return {
      plan,
      allowImages: true,
      allowVideo: true,
      allowOtherBinary: true,
      maxBytes: 250 * 1024 * 1024, // 250MB
    };
  }
  return {
    plan,
    allowImages: true,
    allowVideo: true,
    allowOtherBinary: true,
    maxBytes: 500 * 1024 * 1024, // 500MB
  };
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

async function getDailyUsage(db: Db, agencyId: string, date: string) {
  const row = (await db.get(
    `SELECT messages_count, uploads_count
     FROM usage_daily
     WHERE agency_id = ? AND date = ?
     LIMIT 1`,
    agencyId,
    date
  )) as { messages_count?: number; uploads_count?: number } | undefined;

  return {
    messages_count: Number(row?.messages_count ?? 0),
    uploads_count: Number(row?.uploads_count ?? 0),
  };
}

async function incrementUploads(db: Db, agencyId: string, date: string, by: number) {
  await db.run(
    `INSERT INTO usage_daily (agency_id, date, messages_count, uploads_count)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(agency_id, date)
     DO UPDATE SET uploads_count = uploads_count + ?`,
    agencyId,
    date,
    by,
    by
  );
}

async function enforceUploadLimit(db: Db, agencyId: string, planFromCtx: string | null, count: number, dateKey: string) {
  const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, agencyId)) as
    | { plan?: string | null }
    | undefined;

  const plan = normalizePlan(planRow?.plan ?? planFromCtx ?? null);
  const limits = getPlanLimits(plan);
  const dailyLimit = limits.daily_uploads;

  if (dailyLimit == null) {
    return { ok: true as const, used: 0, dailyLimit: null as number | null, plan };
  }

  const usage = await getDailyUsage(db, agencyId, dateKey);

  if (usage.uploads_count + count > Number(dailyLimit)) {
    return {
      ok: false as const,
      used: usage.uploads_count,
      dailyLimit: Number(dailyLimit),
      plan,
    };
  }

  return {
    ok: true as const,
    used: usage.uploads_count,
    dailyLimit: Number(dailyLimit),
    plan,
  };
}

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

async function assertBotAccessAndGetVectorStore(db: Db, args: { bot_id: string; agency_id: string; user_id: string }) {
  const bot = (await db.get(
    `SELECT id, name, vector_store_id, owner_user_id, agency_id
     FROM bots
     WHERE id = ? AND agency_id = ?
       AND (owner_user_id IS NULL OR owner_user_id = ?)
     LIMIT 1`,
    args.bot_id,
    args.agency_id,
    args.user_id
  )) as
    | { id: string; name: string; vector_store_id: string | null; owner_user_id: string | null; agency_id: string }
    | undefined;

  if (!bot?.id) return { ok: false as const, error: "BOT_NOT_FOUND" as const };

  if (!bot.vector_store_id) {
    return {
      ok: false as const,
      error: "BOT_VECTOR_STORE_MISSING" as const,
      bot_id: bot.id,
    };
  }

  return { ok: true as const, bot, vector_store_id: bot.vector_store_id };
}

function isFileLike(v: any): v is File {
  return v && typeof v === "object" && typeof v.name === "string" && typeof v.arrayBuffer === "function";
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);

    const db: Db = await getDb();
    await ensureSchema(db);

    const agencyTz = await getAgencyTimezone(db, ctx.agencyId);
    const dateKey = ymdInTz(agencyTz);

    // Resolve plan (agency DB is source of truth, ctx.plan is fallback)
    const planRow = (await db.get(`SELECT plan FROM agencies WHERE id = ? LIMIT 1`, ctx.agencyId)) as
      | { plan?: string | null }
      | undefined;

    const planKey = asPlanKey(planRow?.plan ?? ctx.plan ?? "free");
    const policy = uploadPolicy(planKey);

    const form = await req.formData();

    // Compatibility:
    // Some UIs send a single "file" field; others send multiple under "files".
    const rawA = form.getAll("files");
    const rawB = form.getAll("file");
    const files = [...rawA, ...rawB].filter(isFileLike) as File[];

    if (!files.length) {
      const keys: string[] = [];
      try {
        for (const [k] of (form as any).entries?.() ?? []) keys.push(String(k));
      } catch {}
      return Response.json(
        {
          ok: false,
          error: "No files uploaded",
          hint: "Expected multipart field name 'files' (multiple) or 'file' (single).",
          received_fields: Array.from(new Set(keys)).slice(0, 50),
        },
        { status: 400 }
      );
    }

    // HARD GATING: size + mime before any OpenAI calls
    for (const file of files) {
      const size = Number((file as any).size ?? 0);
      if (!Number.isFinite(size) || size <= 0) {
        return Response.json({ ok: false, error: "INVALID_FILE" }, { status: 400 });
      }

      if (size > policy.maxBytes) {
        return Response.json(
          {
            ok: false,
            error: "FILE_TOO_LARGE",
            message: `File exceeds size limit for plan '${policy.plan}'.`,
            plan: policy.plan,
            maxBytes: policy.maxBytes,
            file: { name: file.name, size },
          },
          { status: 413 }
        );
      }

      const mime = String((file as any).type ?? "");
      const kind = classifyMime(mime);

      if (kind === "image" && !policy.allowImages) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Images are not allowed on plan '${policy.plan}'.`,
            plan: policy.plan,
            file: { name: file.name, type: mime, kind },
          },
          { status: 403 }
        );
      }

      if (kind === "video" && !policy.allowVideo) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `Video is not allowed on plan '${policy.plan}'.`,
            plan: policy.plan,
            file: { name: file.name, type: mime, kind },
          },
          { status: 403 }
        );
      }

      if (kind === "other" && !policy.allowOtherBinary) {
        return Response.json(
          {
            ok: false,
            error: "MIME_NOT_ALLOWED",
            message: `This file type is not allowed on plan '${policy.plan}'.`,
            plan: policy.plan,
            file: { name: file.name, type: mime, kind },
          },
          { status: 403 }
        );
      }
    }

    // Daily upload limit (from plans.ts) — uses agency-local day key
    const uploadGate = await enforceUploadLimit(db, ctx.agencyId, ctx.plan, files.length, dateKey);
    if (!uploadGate.ok) {
      return Response.json(
        {
          error: "DAILY_UPLOAD_LIMIT_EXCEEDED",
          used: uploadGate.used,
          daily_limit: uploadGate.dailyLimit,
          plan: uploadGate.plan,
          timezone: agencyTz,
          date: dateKey,
        },
        { status: 429 }
      );
    }

    let bot_id = String(form.get("bot_id") ?? "").trim();
    if (!bot_id) {
      const fallback = await getFallbackBotId(db, ctx.agencyId, ctx.userId);
      if (!fallback) {
        return Response.json({ ok: false, error: "No bots found for this agency/user" }, { status: 404 });
      }
      bot_id = fallback;
    }

    const ensured = await assertBotAccessAndGetVectorStore(db, {
      bot_id,
      agency_id: ctx.agencyId,
      user_id: ctx.userId,
    });

    if (!ensured.ok) {
      if (ensured.error === "BOT_VECTOR_STORE_MISSING") {
        return Response.json(
          {
            ok: false,
            error: "This bot can’t accept uploads yet (vector store missing).",
            code: "BOT_VECTOR_STORE_MISSING",
            bot_id,
          },
          { status: 409 }
        );
      }
      return Response.json({ ok: false, error: "Bot not found" }, { status: 404 });
    }

    const vectorStoreId = ensured.vector_store_id;

    const uploaded: Array<{ document_id: string; filename: string; openai_file_id: string }> = [];

    for (const file of files) {
      const uploadedFile = await openai.files.create({
        file,
        purpose: "assistants",
      });

      const vsFile = await openai.vectorStores.files.create(vectorStoreId, {
        file_id: uploadedFile.id,
      });

      const start = Date.now();
      while (true) {
        const cur = await openai.vectorStores.files.retrieve(vsFile.id, {
          vector_store_id: vectorStoreId,
        });

        if (cur.status === "completed") break;
        if (cur.status === "failed") throw new Error(`Indexing failed for ${file.name}`);
        if (Date.now() - start > 120_000) throw new Error(`Indexing timed out for ${file.name}`);

        await new Promise((r) => setTimeout(r, 1500));
      }

      const created_at = nowIso();

      await db.run(
        `INSERT INTO documents (id, agency_id, bot_id, title, mime_type, bytes, openai_file_id, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)`,
        ctx.agencyId,
        bot_id,
        file.name,
        file.type || null,
        (file as any).size ?? 0,
        uploadedFile.id,
        created_at
      );

      const row = (await db.get(
        `SELECT id
         FROM documents
         WHERE agency_id = ? AND bot_id = ? AND openai_file_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        ctx.agencyId,
        bot_id,
        uploadedFile.id
      )) as { id: string } | undefined;

      uploaded.push({
        document_id: row?.id ?? "",
        filename: file.name,
        openai_file_id: uploadedFile.id,
      });
    }

    await incrementUploads(db, ctx.agencyId, dateKey, files.length);

    return Response.json({ ok: true, bot_id, uploaded, date: dateKey, timezone: agencyTz });
  } catch (err: any) {
    const code = String(err?.code ?? err?.message ?? err);

    if (code === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (code === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Forbidden" }, { status: 403 });

    console.error("UPLOAD_ERROR", err);

    const msg = String(err?.message || "");
    const isBilling =
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("billing") ||
      msg.toLowerCase().includes("payment") ||
      msg.includes("You exceeded your current quota") ||
      msg.includes("429");

    return Response.json(
      {
        ok: false,
        error: isBilling ? "OpenAI billing/quota required to upload documents" : "Server error",
        message: msg,
      },
      { status: isBilling ? 402 : 500 }
    );
  }
}