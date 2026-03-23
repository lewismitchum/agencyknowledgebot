import { promises as fs } from "fs";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { openai } from "@/lib/openai";
import type { Db } from "@/lib/db";

type VideoDocRow = {
  id: string;
  agency_id: string;
  bot_id: string;
  title: string | null;
  mime_type: string | null;
  openai_file_id: string | null;
  source_path: string | null;
};

type VideoExtractionRow = {
  document_id?: string;
  transcript?: string | null;
  frames_summary?: string | null;
  video_summary?: string | null;
  status?: string | null;
  error_message?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ExtractResult = {
  ok: boolean;
  document_id: string;
  status: "completed" | "processing" | "failed" | "missing_file" | "unsupported";
  transcript: string;
  frames_summary: string;
  video_summary: string;
  error?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function compact(v: unknown) {
  return String(v ?? "").trim();
}

function isVideoMime(mime: string | null | undefined) {
  return compact(mime).toLowerCase().startsWith("video/");
}

function makeTempDirName(prefix: string) {
  const uuid =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

async function ensureVideoExtractionSchema(db: Db) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS video_extractions (
      document_id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      transcript TEXT,
      frames_summary TEXT,
      video_summary TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.run(`CREATE INDEX IF NOT EXISTS idx_video_extractions_agency ON video_extractions(agency_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_video_extractions_bot ON video_extractions(bot_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_video_extractions_status ON video_extractions(status)`);
}

async function getDocumentPathColumns(db: Db) {
  const cols = (await db.all(`PRAGMA table_info(documents)`)) as Array<{ name?: string }>;
  const names = cols.map((c) => compact(c.name));

  const candidates = [
    "storage_path",
    "file_path",
    "path",
    "local_path",
    "filepath",
    "disk_path",
    "server_path",
    "blob_path",
    "temp_path",
    "upload_path",
    "original_path",
  ];

  return candidates.filter((c) => names.includes(c));
}

async function loadVideoDocument(
  db: Db,
  args: { agencyId: string; botId: string; documentId: string }
): Promise<VideoDocRow | null> {
  const pathColumns = await getDocumentPathColumns(db);
  const selectPath = pathColumns.length ? `, COALESCE(${pathColumns.join(", ")}) AS source_path` : `, NULL AS source_path`;

  const row = (await db.get(
    `SELECT id, agency_id, bot_id, title, mime_type, openai_file_id ${selectPath}
     FROM documents
     WHERE agency_id = ?
       AND bot_id = ?
       AND id = ?
     LIMIT 1`,
    args.agencyId,
    args.botId,
    args.documentId
  )) as
    | {
        id?: string;
        agency_id?: string;
        bot_id?: string;
        title?: string | null;
        mime_type?: string | null;
        openai_file_id?: string | null;
        source_path?: string | null;
      }
    | undefined;

  if (!row?.id) return null;

  return {
    id: compact(row.id),
    agency_id: compact(row.agency_id),
    bot_id: compact(row.bot_id),
    title: row.title ?? null,
    mime_type: row.mime_type ?? null,
    openai_file_id: row.openai_file_id ?? null,
    source_path: row.source_path ?? null,
  };
}

async function getExtractionRow(db: Db, documentId: string) {
  const row = (await db.get(
    `SELECT document_id, transcript, frames_summary, video_summary, status, error_message, updated_at, created_at
     FROM video_extractions
     WHERE document_id = ?
     LIMIT 1`,
    documentId
  )) as VideoExtractionRow | undefined;

  return row ?? null;
}

async function upsertExtractionRow(
  db: Db,
  args: {
    documentId: string;
    agencyId: string;
    botId: string;
    transcript?: string;
    framesSummary?: string;
    videoSummary?: string;
    status: string;
    errorMessage?: string;
  }
) {
  await db.run(
    `INSERT INTO video_extractions
     (document_id, agency_id, bot_id, transcript, frames_summary, video_summary, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET
       transcript = excluded.transcript,
       frames_summary = excluded.frames_summary,
       video_summary = excluded.video_summary,
       status = excluded.status,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`,
    args.documentId,
    args.agencyId,
    args.botId,
    args.transcript ?? "",
    args.framesSummary ?? "",
    args.videoSummary ?? "",
    args.status,
    args.errorMessage ?? "",
    nowIso(),
    nowIso()
  );
}

function binaryExists(name: string) {
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const p of paths) {
    const full = path.join(p, name);
    if (existsSync(full)) return true;
    if (process.platform === "win32" && existsSync(`${full}.exe`)) return true;
  }
  return false;
}

async function runCommand(cmd: string, args: string[], cwd?: string) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${cmd} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function getVideoDurationSeconds(videoPath: string) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);

  const n = Number(stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildFrameTimestamps(durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [1, 3, 5, 7];
  if (durationSec <= 8) {
    return [0.5, durationSec * 0.3, durationSec * 0.6, Math.max(0.5, durationSec - 0.75)];
  }
  return [
    Math.max(1, durationSec * 0.1),
    Math.max(2, durationSec * 0.35),
    Math.max(3, durationSec * 0.6),
    Math.max(4, durationSec * 0.85),
  ];
}

async function extractAudioToMp3(videoPath: string, audioOutPath: string) {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioOutPath,
  ]);
}

async function extractFrameImages(videoPath: string, outDir: string, durationSec: number) {
  const timestamps = buildFrameTimestamps(durationSec);
  const outPaths: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const framePath = path.join(outDir, `frame-${i + 1}.jpg`);
    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(timestamps[i]),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-vf",
      "scale=1280:-2",
      framePath,
    ]);
    if (existsSync(framePath)) outPaths.push(framePath);
  }

  return outPaths;
}

async function transcribeAudio(audioPath: string) {
  const audioFile = await fs.open(audioPath, "r");
  try {
    const resp = await openai.audio.transcriptions.create({
      file: audioFile.createReadStream() as any,
      model: "gpt-4o-mini-transcribe",
    });
    return compact((resp as any)?.text);
  } finally {
    await audioFile.close();
  }
}

function toDataUrl(mime: string, buf: Buffer) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function summarizeFrames(framePaths: string[], title: string) {
  if (!framePaths.length) return "";

  const content: any[] = [
    {
      type: "input_text",
      text: `Summarize the most important visible content across these video frames for a workspace AI assistant.
Focus on:
- people, objects, UI, screens, charts, scenes
- any readable text
- actions/events
- anything useful for answering future questions

Write plain text only.
Keep it compact but informative.
Video title: ${title || "video"}`,
    },
  ];

  for (const framePath of framePaths.slice(0, 4)) {
    const buf = await fs.readFile(framePath);
    content.push({
      type: "input_image",
      image_url: toDataUrl("image/jpeg", buf),
    });
  }

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [{ role: "user", content }],
  });

  return compact(resp.output_text);
}

async function buildFinalVideoSummary(args: {
  title: string;
  transcript: string;
  framesSummary: string;
}) {
  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
You are building a reusable grounded video context summary for Louis.Ai.

Rules:
- Plain text only.
- Do not invent details.
- Merge transcript evidence and frame evidence.
- Keep it concise but useful for future retrieval.
- Preserve names, visible text, actions, topics, and any key decisions or instructions.

Video title:
${compact(args.title) || "(unknown)"}

Transcript:
${compact(args.transcript) || "(none)"}

Frame summary:
${compact(args.framesSummary) || "(none)"}
`.trim(),
  });

  return compact(resp.output_text);
}

export async function extractVideoContextForDocument(
  db: Db,
  args: { agencyId: string; botId: string; documentId: string }
): Promise<ExtractResult> {
  await ensureVideoExtractionSchema(db);

  const doc = await loadVideoDocument(db, args);
  if (!doc) {
    return {
      ok: false,
      document_id: args.documentId,
      status: "unsupported",
      transcript: "",
      frames_summary: "",
      video_summary: "",
      error: "Document not found",
    };
  }

  if (!isVideoMime(doc.mime_type)) {
    return {
      ok: false,
      document_id: doc.id,
      status: "unsupported",
      transcript: "",
      frames_summary: "",
      video_summary: "",
      error: "Document is not a video",
    };
  }

  const sourcePath = compact(doc.source_path);
  if (!sourcePath || !existsSync(sourcePath)) {
    await upsertExtractionRow(db, {
      documentId: doc.id,
      agencyId: doc.agency_id,
      botId: doc.bot_id,
      status: "missing_file",
      errorMessage: "Video file path is missing or not readable on the server",
    });

    return {
      ok: false,
      document_id: doc.id,
      status: "missing_file",
      transcript: "",
      frames_summary: "",
      video_summary: "",
      error: "Video file path is missing or not readable on the server",
    };
  }

  if (!binaryExists("ffmpeg") || !binaryExists("ffprobe")) {
    await upsertExtractionRow(db, {
      documentId: doc.id,
      agencyId: doc.agency_id,
      botId: doc.bot_id,
      status: "failed",
      errorMessage: "ffmpeg/ffprobe not available on server",
    });

    return {
      ok: false,
      document_id: doc.id,
      status: "failed",
      transcript: "",
      frames_summary: "",
      video_summary: "",
      error: "ffmpeg/ffprobe not available on server",
    };
  }

  await upsertExtractionRow(db, {
    documentId: doc.id,
    agencyId: doc.agency_id,
    botId: doc.bot_id,
    status: "processing",
  });

  const tempDir = path.join(os.tmpdir(), makeTempDirName("louis-video"));
  await fs.mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, "audio.mp3");

  try {
    const durationSec = await getVideoDurationSeconds(sourcePath);
    await extractAudioToMp3(sourcePath, audioPath);
    const framePaths = await extractFrameImages(sourcePath, tempDir, durationSec);

    let transcript = "";
    let framesSummary = "";
    let videoSummary = "";

    try {
      if (existsSync(audioPath)) {
        transcript = await transcribeAudio(audioPath);
      }
    } catch {}

    try {
      if (framePaths.length) {
        framesSummary = await summarizeFrames(framePaths, compact(doc.title) || "video");
      }
    } catch {}

    try {
      videoSummary = await buildFinalVideoSummary({
        title: compact(doc.title),
        transcript,
        framesSummary,
      });
    } catch {
      videoSummary = compact([transcript, framesSummary].filter(Boolean).join("\n\n"));
    }

    await upsertExtractionRow(db, {
      documentId: doc.id,
      agencyId: doc.agency_id,
      botId: doc.bot_id,
      transcript,
      framesSummary,
      videoSummary,
      status: "completed",
    });

    return {
      ok: true,
      document_id: doc.id,
      status: "completed",
      transcript,
      frames_summary: framesSummary,
      video_summary: videoSummary,
    };
  } catch (err: any) {
    const error = compact(err?.message || err) || "Video extraction failed";

    await upsertExtractionRow(db, {
      documentId: doc.id,
      agencyId: doc.agency_id,
      botId: doc.bot_id,
      status: "failed",
      errorMessage: error,
    });

    return {
      ok: false,
      document_id: doc.id,
      status: "failed",
      transcript: "",
      frames_summary: "",
      video_summary: "",
      error,
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export async function getVideoContextForAttachments(
  db: Db,
  args: { agencyId: string; botId: string; documentIds: string[] }
) {
  await ensureVideoExtractionSchema(db);

  const ids = Array.from(new Set((args.documentIds || []).map((x) => compact(x)).filter(Boolean))).slice(0, 8);
  if (!ids.length) return [];

  const out: Array<{
    document_id: string;
    transcript: string;
    frames_summary: string;
    video_summary: string;
    status: string;
  }> = [];

  for (const documentId of ids) {
    const doc = await loadVideoDocument(db, {
      agencyId: args.agencyId,
      botId: args.botId,
      documentId,
    });

    if (!doc || !isVideoMime(doc.mime_type)) continue;

    let row = await getExtractionRow(db, documentId);

    if (!row || compact(row.status) !== "completed") {
      const extracted = await extractVideoContextForDocument(db, {
        agencyId: args.agencyId,
        botId: args.botId,
        documentId,
      });

      row = {
        document_id: documentId,
        transcript: extracted.transcript,
        frames_summary: extracted.frames_summary,
        video_summary: extracted.video_summary,
        status: extracted.status,
      };
    }

    out.push({
      document_id: documentId,
      transcript: compact(row?.transcript),
      frames_summary: compact(row?.frames_summary),
      video_summary: compact(row?.video_summary),
      status: compact(row?.status) || "unknown",
    });
  }

  return out;
}