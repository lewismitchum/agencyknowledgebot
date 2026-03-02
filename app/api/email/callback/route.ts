// app/api/email/callback/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, type Db } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { requireActiveMember } from "@/lib/authz";
import { getAgencyPlan } from "@/lib/enforcement";
import { normalizePlan, requireFeature } from "@/lib/plans";
import { exchangeGoogleCodeForTokens, fetchGoogleUserEmail, GOOGLE_PROVIDER } from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoPlusSeconds(seconds: number) {
  const now = Date.now();
  const ms = Math.max(0, Math.floor(seconds || 0)) * 1000;
  return new Date(now + ms).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveMember(req);
    const db: Db = await getDb();
    await ensureSchema(db);

    const rawPlan = await getAgencyPlan(db, ctx.agencyId, ctx.plan);
    const planKey = normalizePlan(rawPlan);
    const gate = requireFeature(planKey, "email");
    if (!gate.ok) return NextResponse.redirect(new URL("/app/billing", req.url));

    const url = new URL(req.url);
    const code = String(url.searchParams.get("code") || "").trim();
    const state = String(url.searchParams.get("state") || "").trim();

    const cookieState = String(req.cookies.get("email_oauth_state")?.value || "").trim();

    if (!code || !state || !cookieState || state !== cookieState) {
      return NextResponse.redirect(new URL("/app/email/inbox?error=oauth_state", req.url));
    }

    const ex = await exchangeGoogleCodeForTokens(code);
    if (!ex.ok) {
      return NextResponse.redirect(new URL("/app/email/inbox?error=token_exchange", req.url));
    }

    const accessToken = ex.tokens.access_token;
    const refreshToken = ex.tokens.refresh_token; // may be null if user previously consented without prompt=consent
    const scope = ex.tokens.scope || "";
    const expiresAt = isoPlusSeconds(ex.tokens.expires_in || 0);

    const mailboxEmail = accessToken ? await fetchGoogleUserEmail(accessToken) : null;

    // Upsert connection
    const id = `emacc_${randomUUID()}`;

    // If a row exists, keep existing refresh_token if Google didn’t return one this time.
    const existing = (await db.get(
      `SELECT id, refresh_token
       FROM email_accounts
       WHERE agency_id = ? AND user_id = ? AND provider = ?
       LIMIT 1`,
      ctx.agencyId,
      ctx.userId,
      GOOGLE_PROVIDER
    )) as { id: string; refresh_token: string | null } | undefined;

    if (existing?.id) {
      const keepRefresh = String(existing.refresh_token ?? "").trim();
      const finalRefresh = refreshToken ? refreshToken : keepRefresh || null;

      await db.run(
        `UPDATE email_accounts
         SET email = ?,
             scope = ?,
             access_token = ?,
             refresh_token = ?,
             token_expires_at = ?,
             updated_at = datetime('now')
         WHERE id = ? AND agency_id = ? AND user_id = ? AND provider = ?`,
        mailboxEmail,
        scope || null,
        accessToken || null,
        finalRefresh,
        expiresAt || null,
        existing.id,
        ctx.agencyId,
        ctx.userId,
        GOOGLE_PROVIDER
      );
    } else {
      await db.run(
        `INSERT INTO email_accounts
         (id, agency_id, user_id, provider, email, scope, access_token, refresh_token, token_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        id,
        ctx.agencyId,
        ctx.userId,
        GOOGLE_PROVIDER,
        mailboxEmail,
        scope || null,
        accessToken || null,
        refreshToken || null,
        expiresAt || null
      );
    }

    const res = NextResponse.redirect(new URL("/app/email/inbox?connected=1", req.url));
    // clear cookie
    res.cookies.set("email_oauth_state", "", { path: "/", maxAge: 0 });

    return res;
  } catch (err: any) {
    const msg = String(err?.code ?? err?.message ?? err);
    if (msg === "UNAUTHENTICATED") return NextResponse.redirect(new URL("/login", req.url));
    if (msg === "FORBIDDEN_NOT_ACTIVE") return NextResponse.redirect(new URL("/app", req.url));
    return NextResponse.redirect(new URL("/app/email/inbox?error=server", req.url));
  }
}