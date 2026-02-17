import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey || !apiKey.startsWith("sk-")) {
  throw new Error("Missing or invalid OPENAI_API_KEY");
}

export const openai = new OpenAI({
  apiKey,
});
