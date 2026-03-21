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

type UploadRoute = {
  destination: "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email" | "clarify";
  confidence: "high" | "medium" | "low";
  reason: string;
  asks_clarification: boolean;
  suggested_question: string | null;
};

type AutoCreatedItem =
  | {
      type: "task";
      id: string;
      title: string;
      due_at: string | null;
    }
  | {
      type: "event";
      id: string;
      title: string;
      start_at: string;
      end_at: string | null;
    };

type UploadedResult = {
  document_id?: string;
  filename: string;
  openai_file_id?: string;
  route?: UploadRoute;
  auto_created?: AutoCreatedItem[];
  extracted_text_preview?: string;
};

type ClarifyChoice = "knowledge" | "schedule" | "spreadsheets" | "outreach" | "email";

function routeLabel(route?: UploadRoute) {
  switch (route?.destination) {
    case "knowledge":
      return "Saved to bot knowledge";
    case "schedule":
      return "Routed to schedule";
    case "spreadsheets":
      return "Routed to spreadsheets";
    case "outreach":
      return "Routed to outreach";
    case "email":
      return "Routed to email";
    case "clarify":
      return "Needs clarification";
    default:
      return "Uploaded";
  }
}

function routeTone(route?: UploadRoute) {
  switch (route?.destination) {
    case "knowledge":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "schedule":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "spreadsheets":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "outreach":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "email":
      return "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "clarify":
      return "bg-orange-50 text-orange-700 border-orange-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getAutoCreatedCounts(items?: AutoCreatedItem[]) {
  const list = Array.isArray(items) ? items : [];
  let tasks = 0;
  let events = 0;

  for (const item of list) {
    if (item.type === "task") tasks += 1;
    if (item.type === "event") events += 1;
  }

  return { tasks, events, total: tasks + events };
}

function resultLabel(item: UploadedResult) {
  const counts = getAutoCreatedCounts(item.auto_created);

  if (counts.total > 0) {
    if (counts.tasks > 0 && counts.events > 0) {
      return `${counts.tasks} task${counts.tasks === 1 ? "" : "s"} created • ${counts.events} event${counts.events === 1 ? "" : "s"} created`;
    }
    if (counts.tasks > 0) {
      return `${counts.tasks} task${counts.tasks === 1 ? "" : "s"} created`;
    }
    if (counts.events > 0) {
      return `${counts.events} event${counts.events === 1 ? "" : "s"} created`;
    }
  }

  if (item.route?.destination === "schedule") return "Needs clarification before creating schedule items";
  if (item.route?.destination === "knowledge") return "Saved to knowledge only";
  if (item.route?.destination === "spreadsheets") return "Waiting for spreadsheet routing";
  if (item.route?.destination === "outreach") return "Waiting for outreach verification";
  if (item.route?.destination === "email") return "Waiting for email routing";
  if (item.route?.destination === "clarify") return "Needs clarification";
  return "Uploaded successfully";
}

function resultTone(item: UploadedResult) {
  const counts = getAutoCreatedCounts(item.auto_created);

  if (counts.total > 0) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }

  if (item.route?.destination === "schedule" || item.route?.destination === "clarify" || item.route?.asks_clarification) {
    return "bg-orange-50 text-orange-700 border-orange-200";
  }

  return "bg-muted text-muted-foreground border-border";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function nextRouteFromChoice(choice: ClarifyChoice): UploadRoute {
  return {
    destination: choice,
    confidence: "medium",
    reason: `Routing set to ${choice} by user.`,
    asks_clarification: false,
    suggested_question: null,
  };
}

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
  const [uploaded, setUploaded] = useState<UploadedResult[]>([]);
  const [clarifyBusyKey, setClarifyBusyKey] = useState<string>("");

  useEffect(() => {
    console.log("UPLOAD_PAGE_RUNNING", "app/(app)/app/docs/upload/page.tsx");
  }, []);

  async function refreshMe() {
    const r = await fetch("/api/me", { credentials: "include", cache: "no-store" });

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
        const r = await fetch("/api/bots", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => null);

        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }

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

  const clarificationItems = useMemo(() => uploaded.filter((u) => u.route?.asks_clarification), [uploaded]);

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

    if (uploadsRemaining !== null && uploadsRemaining <= 0) {
      return setMsg("Daily upload limit reached for your plan.");
    }

    setUploading(true);
    try {
      const results: UploadedResult[] = [];

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
          if (r.status === 403 && j?.error === "DAILY_UPLOAD_LIMIT_EXCEEDED") {
            await refreshMe();
            throw new Error(`Daily upload limit reached (${j?.used ?? "?"}/${j?.daily_limit ?? "?"}).`);
          }

          if (r.status === 409) {
            throw new Error("This bot has no vector store yet. Go to Documents and click “Repair Vector Store”.");
          }

          if (r.status === 402) {
            throw new Error("OpenAI quota/billing issue. Uploads are temporarily unavailable.");
          }

          if (r.status === 401) {
            window.location.href = "/login";
            return;
          }

          throw new Error(j?.error || j?.message || raw || `Error (${r.status})`);
        }

        if (Array.isArray(j?.uploaded) && j.uploaded.length) {
          for (const u of j.uploaded) {
            results.push({
              document_id: u?.document_id ? String(u.document_id) : undefined,
              filename: String(u?.filename || f.name),
              openai_file_id: u?.openai_file_id ? String(u.openai_file_id) : undefined,
              route: u?.route || undefined,
              auto_created: Array.isArray(u?.auto_created) ? u.auto_created : [],
              extracted_text_preview: typeof u?.extracted_text_preview === "string" ? u.extracted_text_preview : "",
            });
          }
        } else if (j?.doc?.filename) {
          results.push({
            document_id: j?.doc?.document_id ? String(j.doc.document_id) : undefined,
            filename: String(j.doc.filename),
            openai_file_id: j?.doc?.openai_file_id ? String(j.doc.openai_file_id) : undefined,
            auto_created: [],
            extracted_text_preview: "",
          });
        } else {
          results.push({ filename: f.name, auto_created: [], extracted_text_preview: "" });
        }

        await refreshMe();
      }

      setUploaded(results);
      setFiles([]);

      const clarificationCount = results.filter((x) => x.route?.asks_clarification).length;
      if (clarificationCount > 0) {
        setMsg("Upload complete. Some files need clarification before Louis can route them fully.");
      } else {
        setMsg("Upload complete. Louis routed your files automatically.");
      }
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function resolveClarification(index: number, choice: ClarifyChoice) {
    const item = uploaded[index];
    const busyKey = `${index}:${choice}`;

    if (!item?.document_id) {
      setMsg("Missing document id for clarification.");
      return;
    }

    setClarifyBusyKey(busyKey);
    setMsg("");

    try {
      const r = await fetch("/api/documents/resolve-route", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document_id: item.document_id,
          bot_id: selectedBotId,
          choice,
        }),
      });

      const raw = await r.text().catch(() => "");
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {}

      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!r.ok) {
        throw new Error(j?.error || j?.message || raw || `Error (${r.status})`);
      }

      setUploaded((prev) =>
        prev.map((u, i) => {
          if (i !== index) return u;

          return {
            ...u,
            route: j?.item?.route || nextRouteFromChoice(choice),
            auto_created: Array.isArray(j?.item?.auto_created) ? j.item.auto_created : u.auto_created || [],
            extracted_text_preview:
              typeof j?.item?.extracted_text_preview === "string" ? j.item.extracted_text_preview : u.extracted_text_preview || "",
          };
        })
      );

      setMsg("Clarification saved.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to resolve clarification");
    } finally {
      setClarifyBusyKey("");
    }
  }

  const isError =
    msg.toLowerCase().includes("error") ||
    msg.toLowerCase().includes("failed") ||
    msg.toLowerCase().includes("limit");

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
          Upload once. Louis should verify what the file is for, route it where it belongs, and only ask when it is not sure.
        </p>
      </div>

      <Card className="card-premium overflow-hidden rounded-3xl">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl tracking-tight">Upload docs to a bot</CardTitle>
              <CardDescription>
                Files are saved to the selected bot first, then Louis decides where the information should go.
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
                      Selected: <span className="font-medium text-foreground">{files.length}</span>{" "}
                      {files.length ? <span className="text-muted-foreground">({totalSizeMB} MB)</span> : null}
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
                      <p className={["text-sm", isError ? "text-red-600" : "text-muted-foreground"].join(" ")}>
                        {msg}{" "}
                        {msg.toLowerCase().includes("vector store") ? (
                          <Link href="/app/docs" className="underline">
                            Repair
                          </Link>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Tip: Upload PDFs, DOCX, TXT.</p>
                    )}
                  </div>
                </div>
              </div>

              {uploaded.length > 0 && (
                <div className="rounded-2xl border bg-muted/30 p-4 md:p-5">
                  <p className="text-sm font-medium">What Louis did</p>
                  <div className="mt-3 space-y-3">
                    {uploaded.map((u, i) => {
                      const createdItems = Array.isArray(u.auto_created) ? u.auto_created : [];
                      return (
                        <div key={`${u.filename}-${i}`} className="rounded-2xl border bg-background p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="font-medium break-words">{u.filename}</div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {u.route?.reason || "Uploaded successfully."}
                              </div>
                            </div>

                            <div className="shrink-0">
                              <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${routeTone(u.route)}`}>
                                {routeLabel(u.route)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3">
                            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${resultTone(u)}`}>
                              {resultLabel(u)}
                            </div>
                          </div>

                          {createdItems.length > 0 ? (
                            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                              <div className="font-medium">Created items</div>
                              <div className="mt-2 space-y-2">
                                {createdItems.map((item) => (
                                  <div key={item.id} className="rounded-lg border border-emerald-200 bg-white/70 p-2">
                                    <div className="font-medium">{item.title}</div>
                                    <div className="mt-1 text-xs text-emerald-700/80">
                                      {item.type === "task"
                                        ? item.due_at
                                          ? `Task • due ${formatDateTime(item.due_at)}`
                                          : "Task"
                                        : item.end_at
                                          ? `Event • ${formatDateTime(item.start_at)} → ${formatDateTime(item.end_at)}`
                                          : `Event • ${formatDateTime(item.start_at)}`}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {u.extracted_text_preview ? (
                            <div className="mt-3 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                              <div className="font-medium text-foreground">What Louis read</div>
                              <div className="mt-2 whitespace-pre-wrap break-words">{u.extracted_text_preview}</div>
                            </div>
                          ) : null}

                          {u.route?.asks_clarification && u.route?.suggested_question ? (
                            <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
                              <div>{u.route.suggested_question}</div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={clarifyBusyKey !== "" || !u.document_id}
                                  onClick={() => resolveClarification(i, "knowledge")}
                                >
                                  {clarifyBusyKey === `${i}:knowledge` ? "Saving..." : "Save as knowledge"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={clarifyBusyKey !== "" || !u.document_id}
                                  onClick={() => resolveClarification(i, "schedule")}
                                >
                                  {clarifyBusyKey === `${i}:schedule` ? "Saving..." : "Create schedule items"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={clarifyBusyKey !== "" || !u.document_id}
                                  onClick={() => resolveClarification(i, "spreadsheets")}
                                >
                                  {clarifyBusyKey === `${i}:spreadsheets` ? "Saving..." : "Send to spreadsheets"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={clarifyBusyKey !== "" || !u.document_id}
                                  onClick={() => resolveClarification(i, "outreach")}
                                >
                                  {clarifyBusyKey === `${i}:outreach` ? "Saving..." : "Send to outreach"}
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full"
                                  disabled={clarifyBusyKey !== "" || !u.document_id}
                                  onClick={() => resolveClarification(i, "email")}
                                >
                                  {clarifyBusyKey === `${i}:email` ? "Saving..." : "Use for email"}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {clarificationItems.length > 0 ? (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 md:p-5">
                  <p className="text-sm font-medium text-orange-800">Needs clarification</p>
                  <div className="mt-2 space-y-2">
                    {clarificationItems.map((u, i) => (
                      <div key={`${u.filename}-clarify-${i}`} className="text-sm text-orange-700">
                        <span className="font-medium">{u.filename}:</span>{" "}
                        {u.route?.suggested_question || "I’m not fully sure where this belongs."}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="text-sm text-muted-foreground">
                Next: review the results, then continue in{" "}
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