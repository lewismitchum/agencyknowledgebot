// lib/document-routing.ts
import { openai } from "@/lib/openai";

export type RouteDestination = "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email" | "clarify";
export type RouteConfidence = "high" | "medium" | "low";
export type ScheduleKind = "task" | "event" | null;

export type ScheduleTaskCandidate = {
  title: string;
  due_at?: string | null;
  notes?: string | null;
};

export type ScheduleEventCandidate = {
  title: string;
  start_at: string;
  end_at?: string | null;
  location?: string | null;
  notes?: string | null;
};

export type DocumentRouteDecision = {
  destination: RouteDestination;
  confidence: RouteConfidence;
  why: string;
  asks_clarification: boolean;
  clarification_question: string | null;
  schedule_kind: ScheduleKind;
  task_candidates: ScheduleTaskCandidate[];
  event_candidates: ScheduleEventCandidate[];
};

type AnalyzeArgs = {
  filename: string;
  mime: string;
  text: string;
  timezone: string;
};

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function clampText(input: string, max = 12000) {
  const s = safeString(input).trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function stripCodeFences(s: string) {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeDestination(v: unknown): RouteDestination {
  const x = safeString(v).trim().toLowerCase();
  if (x === "knowledge" || x === "schedule" || x === "spreadsheets" || x === "outreach" || x === "email" || x === "clarify") {
    return x;
  }
  return "clarify";
}

function normalizeConfidence(v: unknown): RouteConfidence {
  const x = safeString(v).trim().toLowerCase();
  if (x === "high" || x === "medium" || x === "low") return x;
  return "low";
}

function normalizeScheduleKind(v: unknown): ScheduleKind {
  const x = safeString(v).trim().toLowerCase();
  if (x === "task" || x === "event") return x;
  return null;
}

function isIsoDateish(v: unknown) {
  const s = safeString(v).trim();
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function fallbackRoute(args: AnalyzeArgs): DocumentRouteDecision {
  const filename = safeString(args.filename).toLowerCase();
  const text = safeString(args.text).toLowerCase();

  const haystack = `${filename}\n${text}`;

  const hasAny = (...parts: string[]) => parts.some((p) => haystack.includes(p));

  if (hasAny("meeting", "calendar", "agenda", "appointment", "standup", "call at", "meeting at")) {
    return {
      destination: "schedule",
      confidence: "medium",
      why: "The document looks meeting-related, but there is not enough verified structure to auto-create safely.",
      asks_clarification: true,
      clarification_question: "This looks like meeting or calendar content. Should I create schedule items from it?",
      schedule_kind: "event",
      task_candidates: [],
      event_candidates: [],
    };
  }

  if (hasAny("task", "todo", "to-do", "deadline", "action item", "deliverable")) {
    return {
      destination: "schedule",
      confidence: "medium",
      why: "The document looks task-related, but there is not enough verified structure to auto-create safely.",
      asks_clarification: true,
      clarification_question: "This looks like task or deadline content. Should I create schedule tasks from it?",
      schedule_kind: "task",
      task_candidates: [],
      event_candidates: [],
    };
  }

  if (hasAny("csv", "table", "spreadsheet", "budget", "invoice", "forecast", "pipeline")) {
    return {
      destination: "spreadsheets",
      confidence: "medium",
      why: "The document looks structured or tabular.",
      asks_clarification: false,
      clarification_question: null,
      schedule_kind: null,
      task_candidates: [],
      event_candidates: [],
    };
  }

  if (hasAny("lead", "prospect", "contact", "contacts", "company", "@")) {
    return {
      destination: "outreach",
      confidence: "medium",
      why: "The document may contain contact or lead information.",
      asks_clarification: false,
      clarification_question: null,
      schedule_kind: null,
      task_candidates: [],
      event_candidates: [],
    };
  }

  if (hasAny("reply", "draft", "inbox", "thread", "email")) {
    return {
      destination: "email",
      confidence: "medium",
      why: "The document looks email-related.",
      asks_clarification: false,
      clarification_question: null,
      schedule_kind: null,
      task_candidates: [],
      event_candidates: [],
    };
  }

  return {
    destination: "knowledge",
    confidence: "low",
    why: "Defaulted to bot knowledge because the document intent is not verified yet.",
    asks_clarification: true,
    clarification_question:
      "I saved this to bot knowledge. Should I also turn anything inside it into schedule items, spreadsheet data, outreach leads, or email context?",
    schedule_kind: null,
    task_candidates: [],
    event_candidates: [],
  };
}

function normalizeDecision(raw: any, fallback: DocumentRouteDecision): DocumentRouteDecision {
  const destination = normalizeDestination(raw?.destination);
  const confidence = normalizeConfidence(raw?.confidence);
  const schedule_kind = normalizeScheduleKind(raw?.schedule_kind);

  const task_candidates: ScheduleTaskCandidate[] = Array.isArray(raw?.task_candidates)
    ? raw.task_candidates
        .map((x: any) => ({
          title: safeString(x?.title).trim(),
          due_at: safeString(x?.due_at).trim() || null,
          notes: safeString(x?.notes).trim() || null,
        }))
        .filter((x: ScheduleTaskCandidate) => !!x.title)
    : [];

  const event_candidates: ScheduleEventCandidate[] = Array.isArray(raw?.event_candidates)
    ? raw.event_candidates
        .map((x: any) => ({
          title: safeString(x?.title).trim(),
          start_at: safeString(x?.start_at).trim(),
          end_at: safeString(x?.end_at).trim() || null,
          location: safeString(x?.location).trim() || null,
          notes: safeString(x?.notes).trim() || null,
        }))
        .filter((x: ScheduleEventCandidate) => !!x.title && isIsoDateish(x.start_at))
    : [];

  const why = safeString(raw?.why).trim() || fallback.why;
  const clarification_question =
    safeString(raw?.clarification_question).trim() || (raw?.asks_clarification ? fallback.clarification_question : null);

  const asks_clarification =
    Boolean(raw?.asks_clarification) ||
    destination === "clarify" ||
    confidence === "low" ||
    (destination === "schedule" && task_candidates.length === 0 && event_candidates.length === 0);

  return {
    destination,
    confidence,
    why,
    asks_clarification,
    clarification_question: asks_clarification ? clarification_question || fallback.clarification_question : null,
    schedule_kind,
    task_candidates,
    event_candidates,
  };
}

export async function analyzeUploadedDocument(args: AnalyzeArgs): Promise<DocumentRouteDecision> {
  const text = clampText(args.text);
  const fallback = fallbackRoute(args);

  if (!text) return fallback;

  try {
    const prompt = `
You are routing an uploaded business document inside Louis.Ai.

Return STRICT JSON only.

Timezone: ${args.timezone}
Filename: ${args.filename}
Mime: ${args.mime}

Goal:
- Decide where this document belongs:
  - knowledge
  - schedule
  - spreadsheets
  - outreach
  - email
  - clarify

Rules:
- Use "schedule" only when the document clearly contains actionable tasks or dated/time-based events.
- Only create candidates when the document itself gives enough information.
- If confidence is weak, ask for clarification instead of guessing.
- For outreach, only choose outreach when the document appears to contain usable lead/contact info.
- Prefer knowledge when this is mainly reference material, SOPs, policies, notes, guides, or general internal knowledge.
- Do not invent times, dates, emails, or contacts.
- If both tasks and events exist, still use destination "schedule" and include both candidate arrays.
- Event candidate start_at/end_at must be ISO-8601 strings when present.

Return JSON shape:
{
  "destination": "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email" | "clarify",
  "confidence": "high" | "medium" | "low",
  "why": "short reason",
  "asks_clarification": true | false,
  "clarification_question": string | null,
  "schedule_kind": "task" | "event" | null,
  "task_candidates": [
    { "title": string, "due_at": string | null, "notes": string | null }
  ],
  "event_candidates": [
    { "title": string, "start_at": string, "end_at": string | null, "location": string | null, "notes": string | null }
  ]
}

Document text:
"""
${text}
"""`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const rawText =
      safeString((resp as any)?.output_text) ||
      safeString((resp as any)?.output?.[0]?.content?.[0]?.text) ||
      "";

    if (!rawText.trim()) return fallback;

    const parsed = JSON.parse(stripCodeFences(rawText));
    return normalizeDecision(parsed, fallback);
  } catch {
    return fallback;
  }
}