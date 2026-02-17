import { openai } from "@/lib/openai";

export async function summarizeConversation(transcript: string): Promise<string | null> {
  const t = String(transcript || "").trim();
  if (!t) return null;

  try {
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
Summarize the following conversation.

Rules:
- Summarize ONLY what is explicitly stated.
- Do NOT add new facts.
- Do NOT infer or guess.
- Preserve decisions, constraints, preferences, and open questions.
- Write in concise bullet points.
- If nothing meaningful exists, return nothing.

Conversation:
${t}
`.trim(),
    });

    const out = String(resp?.output_text ?? "").trim();
    return out || null;
  } catch (e: any) {
    // IMPORTANT: fail silently — do NOT poison memory
    console.warn("SUMMARIZATION_SKIPPED", String(e?.message ?? e));
    return null;
  }
}
