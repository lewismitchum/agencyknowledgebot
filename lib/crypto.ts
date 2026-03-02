import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_SECRET || "";
  if (!raw || raw.length < 32) {
    throw new Error("OAUTH_TOKEN_SECRET must be at least 32 characters");
  }
  // Derive fixed 32-byte key
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(text: string): string {
  if (!text) return "";

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string | null): string | null {
  if (!payload) return null;

  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return payload; // backward compatibility (plain text)

    const key = getKey();
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    // If decryption fails, assume legacy plaintext
    return payload;
  }
}