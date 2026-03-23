// app/api/chat/export-pdf/route.ts
import { type NextRequest } from "next/server";
import { requireActiveMember } from "@/lib/authz";

export const runtime = "nodejs";

type ExportPdfBody = {
  title?: string;
  text?: string;
  filename?: string;
};

function compact(v: unknown) {
  return String(v ?? "").replace(/\r\n/g, "\n").trim();
}

function sanitizeFilename(name: string) {
  const safe = String(name || "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return safe || "chat-export";
}

function escapePdfText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (word.length <= maxChars) {
        current = word;
      } else {
        let rest = word;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        current = rest;
      }
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function wrapText(text: string, maxChars: number) {
  const rawLines = String(text || "").split("\n");
  const out: string[] = [];

  for (const raw of rawLines) {
    if (!raw.trim()) {
      out.push("");
      continue;
    }
    out.push(...wrapLine(raw, maxChars));
  }

  return out;
}

function buildPdfBuffer(title: string, body: string) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 54;
  const marginTop = 60;
  const marginBottom = 54;
  const titleFontSize = 18;
  const bodyFontSize = 11;
  const titleLineHeight = 24;
  const bodyLineHeight = 16;
  const maxChars = 92;

  const titleLines = wrapText(title, 48);
  const bodyLines = wrapText(body, maxChars);

  const pages: string[][] = [];
  let currentPage: string[] = [];
  let y = pageHeight - marginTop;

  const pushText = (text: string, fontSize: number) => {
    const safe = escapePdfText(text);
    currentPage.push(`BT /F1 ${fontSize} Tf 1 0 0 1 ${marginLeft} ${y} Tm (${safe}) Tj ET`);
  };

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < marginBottom) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - marginTop;
    }
  };

  for (const line of titleLines) {
    ensureSpace(titleLineHeight);
    pushText(line, titleFontSize);
    y -= titleLineHeight;
  }

  y -= 8;

  for (const line of bodyLines) {
    ensureSpace(bodyLineHeight);
    pushText(line || " ", bodyFontSize);
    y -= bodyLineHeight;
  }

  if (currentPage.length === 0) {
    currentPage.push(`BT /F1 ${bodyFontSize} Tf 1 0 0 1 ${marginLeft} ${pageHeight - marginTop} Tm ( ) Tj ET`);
  }

  pages.push(currentPage);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  const fontObjectId = 3;
  let nextId = 4;

  for (let i = 0; i < pages.length; i++) {
    pageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  }

  objects[1] = `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`;
  objects[2] = `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >> endobj`;
  objects[3] = `3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`;

  for (let i = 0; i < pages.length; i++) {
    const pageId = pageObjectIds[i];
    const contentId = contentObjectIds[i];
    const stream = pages[i].join("\n");
    const length = Buffer.byteLength(stream, "utf8");

    objects[pageId] =
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >> endobj`;

    objects[contentId] =
      `${contentId} 0 obj << /Length ${length} >> stream\n${stream}\nendstream\nendobj`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  offsets[0] = 0;

  for (let i = 1; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj) continue;
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${obj}\n`;
  }

  const maxObjectId = objects.length - 1;
  const xrefStart = Buffer.byteLength(pdf, "utf8");

  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += `0000000000 65535 f \n`;

  for (let i = 1; i <= maxObjectId; i++) {
    const offset = offsets[i] ?? 0;
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer << /Size ${maxObjectId + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

export async function POST(req: NextRequest) {
  try {
    await requireActiveMember(req);

    const body = (await req.json().catch(() => null)) as ExportPdfBody | null;
    const title = compact(body?.title) || "Louis.Ai Chat Export";
    const text = compact(body?.text);

    if (!text) {
      return Response.json({ error: "Missing text" }, { status: 400 });
    }

    const filename = `${sanitizeFilename(compact(body?.filename) || title)}.pdf`;
    const pdfBuffer = buildPdfBuffer(title, text);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN_NOT_ACTIVE") return Response.json({ error: "Pending approval" }, { status: 403 });

    console.error("CHAT_EXPORT_PDF_ERROR", err);
    return Response.json({ error: "Server error", message: msg }, { status: 500 });
  }
}