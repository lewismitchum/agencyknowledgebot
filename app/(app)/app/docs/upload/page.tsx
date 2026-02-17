// app/(app)/app/docs/upload/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type BotRow = {
  id: string;
  name: string;
  description?: string | null;
  vector_store_id?: string | null;
};

type MePayload = {
  plan?: string | null;
  user?: { email?: string | null };
  uploads_used?: number;
  uploads_limit?: number | null;
  uploads_remaining?: number | null;
};

export default function DocsUploadPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [bootError, setBootError] = useState("");

  const [plan, setPlan] = useState<string | null>(null);
  const [uploadsUsed, setUploadsUsed] = useState<number>(0);
  const [uploadsLimit, setUploadsLimit] = useState<number | null>(null);
  const [uploadsRemaining, setUploadsRemaining] = useState<number | null>(null);

  const [bots, setBots] = useState<BotRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string>("");

  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<Array<{ filename: string; openai_file_id?: string }>>([]);

  useEffect(() => {
    console.log("UPLOAD_PAGE_RUNNING", "app/(app)/app/docs/upload/page.tsx");
  }, []);

  async function refreshMe() {
    const r = await fetch("/api/me", { credentials: "include" });

    if (r.status === 401) {
      window.location.href = "/login";
      return null;
    }

    if (!r.ok) {
      const raw = await r.text().catch(() => "");
      setBootError(raw || `Failed to load session (${r.status})`);
      return null;
    }

    const j = (await r.json().catch(() => null)) as MePayload | null;
    setUserEmail(j?.user?.email ?? null);

    setPlan(j?.plan ?? null);
    setUploadsUsed(Number(j?.uploads_used ?? 0));
    setUploadsLimit(j?.uploads_limit == null ? null : Number(j.uploads_limit));
    setUploadsRemaining(j?.uploads_remaining == null ? null : Number(j.uploads_remaining));

    return j;
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshMe();
      } catch (e: any) {
        setBootError(e?.message || "Failed to load session");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setBotsLoading(true);
      try {
        const r = await fetch("/api/bots", { credentials: "include" });
        const j = await r.json().catch(() => null);

        if (!r.ok) {
          setMsg(j?.error || `Failed to load bots (${r.status})`);
          setBots([]);
          return;
        }

        const list: BotRow[] = Array.isArray(j?.bots) ? j.bots : [];
        setBots(list);

        if (!selectedBotId && list.length > 0) {
          setSelectedBotId(list[0].id);
        }
      } catch (e: any) {
        setMsg(e?.message || "Failed to load bots");
        setBots([]);
      } finally {
        setBotsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSizeMB = useMemo(() => {
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    return Math.round((bytes / 1024 / 1024) * 10) / 10;
  }, [files]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg("");
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  async function onUpload() {
    setMsg("");
    setUploaded([]);

    if (!files.length) return setMsg("Pick at least 1 file.");
    if (!selectedBotId) return setMsg("Choose a bot first.");

    // Client-side UX guard (server still enforces)
    if (uploadsRemaining !== null && uploadsRemaining <= 0) {
      return setMsg("Daily upload limit reached for your plan.");
    }

    setUploading(true);
    try {
      const results: Array<{ filename: string; openai_file_id?: string }> = [];

      for (const f of files) {
        const form = new FormData();
        form.append("bot_id", selectedBotId);
        form.append("file", f);

        const r = await fetch("/api/documents", {
          method: "POST",
          body: form,
          credentials: "include",
        });

        const raw = await r.text().catch(() => "");
        let j: any = null;
        try {
          j = raw ? JSON.parse(raw) : null;
        } catch {}

        if (!r.ok) {
          // Nice errors by code/status
          if (r.status === 403 && j?.error === "DAILY_UPLOAD_LIMIT_EXCEEDED") {
            await refreshMe();
            throw new Error(
              `Daily upload limit reached (${j?.used ?? "?"}/${j?.daily_limit ?? "?"}).`
            );
          }

          if (r.status === 409) {
            throw new Error(
              "This bot has no vector store yet. Go to Documents and click “Repair Vector Store”."
            );
          }

          if (r.status === 402) {
            throw new Error("OpenAI quota/billing issue. Uploads are temporarily unavailable.");
          }

          throw new Error(j?.error || j?.message || raw || `Error (${r.status})`);
        }

        if (Array.isArray(j?.uploaded) && j.uploaded.length) {
          for (const u of j.uploaded) results.push(u);
        } else if (j?.doc?.filename) {
          results.push({ filename: String(j.doc.filename), openai_file_id: j?.doc?.openai_file_id });
        } else {
          results.push({ filename: f.name });
        }

        // Refresh counters after each success so the UI stays accurate.
        await refreshMe();
      }

      setUploaded(results);
      setFiles([]);
      setMsg("Upload complete. Your docs are ready for chat.");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const isError = msg.toLowerCase().includes("error") || msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("limit");

  const uploadsLabel =
    uploadsLimit == null
      ? `Uploads: ${uploadsUsed} used (unlimited)`
      : `Uploads: ${uploadsUsed}/${uploadsLimit} used • ${uploadsRemaining ?? 0} left today`;

  const uploadsBlocked = uploadsRemaining !== null && uploadsRemaining <= 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Upload documents</h1>
        <p className="text-sm text-muted-foreground">
          Add SOPs, onboarding, FAQs, playbooks, brand guidelines. Louis.Ai answers only from these.
        </p>
      </div>

      <Card className="card-premium overflow-hidden rounded-3xl">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl tracking-tight">Upload docs to a bot</CardTitle>
              <CardDescription>
                Each bot has its own knowledge base. Pick the bot you want to train.
              </CardDescription>
            </div>

            <Link href="/app/chat">
              <Button variant="secondary" size="sm" className="rounded-full">
                Go to chat
              </Button>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <div>
              Signed in as <span className="text-foreground">{userEmail || "—"}</span>
            </div>

            {plan ? (
              <Badge variant="outline" className="rounded-full">
                Plan: {plan}
              </Badge>
            ) : null}

            <Badge variant="outline" className="rounded-full">
              {uploadsLabel}
            </Badge>

            {uploadsBlocked ? (
              <Badge variant="destructive" className="rounded-full">
                Uploads paused (daily limit)
              </Badge>
            ) : null}
          </div>

          <Separator />
        </CardHeader>

        <CardContent className="grid gap-5">
          {bootError ? (
            <div className="rounded-2xl border bg-background/60 p-4 text-sm">
              <div className="font-medium">Session error</div>
              <div className="mt-1 text-muted-foreground">{bootError}</div>
              <div className="mt-3 flex gap-2">
                <Button className="rounded-full" onClick={() => window.location.reload()}>
                  Reload
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/login">Back to login</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border bg-background/60 p-4 md:p-5">
                <label className="text-sm font-medium">Choose bot</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <select
                    value={selectedBotId}
                    onChange={(e) => setSelectedBotId(e.target.value)}
                    disabled={botsLoading}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                  >
                    {botsLoading ? (
                      <option value="">Loading bots…</option>
                    ) : bots.length === 0 ? (
                      <option value="">No bots found</option>
                    ) : (
                      bots.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))
                    )}
                  </select>

                  <Link href="/app/docs" className="text-sm text-muted-foreground underline">
                    Back to documents
                  </Link>
                </div>

                {uploadsBlocked ? (
                  <div className="mt-3 rounded-xl border bg-muted p-3 text-sm text-muted-foreground">
                    Daily upload limit reached.{" "}
                    <Link href="/app/settings/billing" className="underline">
                      Upgrade
                    </Link>{" "}
                    for higher limits.
                  </div>
                ) : null}
              </div>

              <div className="relative overflow-hidden rounded-2xl border bg-background/60 p-4 md:p-5">
                <div className="relative grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Select files</label>
                    <input
                      type="file"
                      multiple
                      onChange={onPick}
                      className="block w-full cursor-pointer rounded-xl border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-background hover:file:opacity-90"
                      disabled={uploadsBlocked}
                    />
                    <p className="text-sm text-muted-foreground">
                      Selected:{" "}
                      <span className="font-medium text-foreground">{files.length}</span>{" "}
                      {files.length ? (
                        <span className="text-muted-foreground">({totalSizeMB} MB)</span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      onClick={onUpload}
                      disabled={uploading || uploadsBlocked || files.length === 0 || !selectedBotId}
                      className="rounded-full"
                    >
                      {uploading ? "Uploading..." : "Upload"}
                    </Button>

                    {msg ? (
                      <p
                        className={[
                          "text-sm",
                          isError ? "text-red-600" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {msg}{" "}
                        {msg.toLowerCase().includes("vector store") ? (
                          <>
                            <Link href="/app/docs" className="underline">
                              Repair
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Tip: Upload PDFs, DOCX, TXT.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {uploaded.length > 0 && (
                <div className="rounded-2xl border bg-muted/30 p-4 md:p-5">
                  <p className="text-sm font-medium">Uploaded</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {uploaded.map((u, i) => (
                      <li key={i}>{u.filename}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-sm text-muted-foreground">
                Next: ask questions in{" "}
                <Link className="text-foreground underline underline-offset-4" href="/app/chat">
                  Chat
                </Link>
                .
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
