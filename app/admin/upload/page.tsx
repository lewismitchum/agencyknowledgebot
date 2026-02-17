"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getSelectedBotId, setSelectedBotId } from "@/lib/selectedbot";

type BotRow = {
  id: string;
  name: string;
  description?: string | null;
  vector_store_id?: string | null;
  owner_user_id?: string | null;
};

export default function UploadPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [bootError, setBootError] = useState("");

  const [bots, setBots] = useState<BotRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);

  // rename setter to avoid colliding with imported setSelectedBotId()
  const [selectedBotIdState, setSelectedBotIdState] = useState<string>("");

  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<
    Array<{ filename: string; openai_file_id: string }>
  >([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });

        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!r.ok) {
          const raw = await r.text().catch(() => "");
          setBootError(raw || `Failed to load session (${r.status})`);
          return;
        }

        const j = await r.json().catch(() => null);
        setUserEmail(j?.user?.email ?? null);
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

        // 1) try saved selection
        const saved = getSelectedBotId();
        const savedExists = saved && list.some((b) => b.id === saved);

        if (savedExists) {
          setSelectedBotIdState(saved!);
          return;
        }

        // 2) prefer private bot, else first
        const preferred = list.find((b) => !!b.owner_user_id) ?? list[0] ?? null;

        if (preferred) {
          setSelectedBotIdState(preferred.id);
          setSelectedBotId(preferred.id);
        } else {
          setSelectedBotIdState("");
          setSelectedBotId(null);
        }
      } catch (e: any) {
        setMsg(e?.message || "Failed to load bots");
        setBots([]);
      } finally {
        setBotsLoading(false);
      }
    })();
  }, []);

  const totalSizeMB = useMemo(() => {
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    return Math.round((bytes / 1024 / 1024) * 10) / 10;
  }, [files]);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotIdState) ?? null,
    [bots, selectedBotIdState]
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg("");
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  async function onUpload() {
    setMsg("");
    if (!files.length) return setMsg("Pick at least 1 file.");
    if (!selectedBotIdState) return setMsg("Choose a bot first.");

    setUploading(true);
    try {
      const form = new FormData();
      form.append("bot_id", selectedBotIdState);
      for (const f of files) form.append("files", f);

      const r = await fetch("/api/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!r.ok) {
        setMsg(j?.error || raw || `Error (${r.status})`);
        return;
      }

      setUploaded(j?.uploaded || []);
      setFiles([]);
      setMsg("Upload complete. Your docs are ready for chat.");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const isError =
    msg.toLowerCase().includes("error") || msg.toLowerCase().includes("failed");

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

          <div className="text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="text-foreground">{userEmail || "—"}</span>
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
                    value={selectedBotIdState}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedBotIdState(id);
                      setSelectedBotId(id || null);
                    }}
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
                          {b.owner_user_id ? `Private: ${b.name}` : `Agency: ${b.name}`}
                        </option>
                      ))
                    )}
                  </select>

                  <Link href="/app/chat" className="text-sm text-muted-foreground underline">
                    Switch in chat later
                  </Link>
                </div>

                {selectedBot ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected:{" "}
                    <span className="text-foreground font-medium">
                      {selectedBot.owner_user_id ? "Private" : "Agency"}: {selectedBot.name}
                    </span>
                    {!selectedBot.vector_store_id ? (
                      <>
                        {" "}
                        <span className="text-muted-foreground">
                          (Vector store not attached yet — uploads may require billing.)
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>

              <div className="relative overflow-hidden rounded-2xl border bg-background/60 p-4 md:p-5">
                <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(900px_300px_at_10%_0%,hsl(var(--primary)/0.10),transparent_60%),radial-gradient(700px_260px_at_90%_10%,hsl(var(--chart-2)/0.10),transparent_55%)]" />
                <div className="relative grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Select files</label>
                    <input
                      type="file"
                      multiple
                      onChange={onPick}
                      className="block w-full cursor-pointer rounded-xl border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-background hover:file:opacity-90"
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
                      disabled={uploading || files.length === 0 || !selectedBotIdState}
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
                        {msg}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Tip: Upload PDFs, DOCX, TXT, and internal docs.
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
