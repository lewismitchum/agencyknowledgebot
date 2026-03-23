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

function escapePdfText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function sanitizeFilename(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || "chat-export";
}

function wrapText(text: string, maxChars: number) {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/).filter(Boolean);
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
  }

  return lines;
}

function buildPdfBytes(title: string, body: string) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 54;
  const marginTop = 60;
  const lineHeight = 16;
  const fontSize = 11;
  const titleSize = 16;
  const maxChars = 92;

  const titleLines = wrapText(title, 60);
  const bodyLines = wrapText(body, maxChars);

  const pages: string[][] = [];
  let currentPage: string[] = [];
  let currentY = pageHeight - marginTop;

  function pushLine(text: string, size = fontSize) {
    if (currentY < 54) {
      pages.push(currentPage);
      currentPage = [];
      currentY = pageHeight - marginTop;
    }

    currentPage.push(`BT /F1 ${size} Tf 1 0 0 1 ${marginLeft} ${currentY} Tm (${escapePdfText(text)}) Tj ET`);
    currentY -= size === titleSize ? 22 : lineHeight;
  }

  for (const line of titleLines) {
    pushLine(line, titleSize);
  }

  currentY -= 8;

  for (const line of bodyLines) {
    pushLine(line || " ", fontSize);
  }

  if (currentPage.length) {
    pages.push(currentPage);
  }

  const objects: string[] = [];
  const pageIds: number[] = [];
  let objectNumber = 1;

  objects.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  objects.push(`2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj`);
  objectNumber = 3;

  const contentObjectIds: number[] = [];

  for (const pageLines of pages) {
    const pageId = objectNumber++;
    const contentId = objectNumber++;
    pageIds.push(pageId);
    contentObjectIds.push(contentId);

    const stream = pageLines.join("\n");
    const streamLength = Buffer.byteLength(stream, "utf8");

    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${objectNumber} 0 R >> >> /Contents ${contentId} 0 R >> endobj`
    );
    objects.push(`${contentId} 0 obj << /Length ${streamLength} >> stream
${stream}
endstream
endobj`);
  }

  const fontId = objectNumber++;
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[1] = `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >> endobj`;

  const fullObjects = objects.map((obj, index) => {
    if (index >= 2 && index < 2 + pageIds.length * 2) {
      return obj.replace(`${objectNumber - 1} 0 R`, `${fontId} 0 R`);
    }
    return obj;
  });

  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [0];

  for (const obj of fullObjects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref
0 ${fullObjects.length + 1}
0000000000 65535 f 
`;

  for (let i = 1; i <= fullObjects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n 
`;
  }

  pdf += `trailer << /Size ${fullObjects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF`;

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
    const pdf = buildPdfBytes(title, text);

    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
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