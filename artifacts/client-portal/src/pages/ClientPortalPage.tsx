import React, { useState, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import {
  ApiError,
  useGetClientSession,
  useExitClientPreview,
  getGetClientSessionQueryKey,
  ClientChecklistItemView,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Trash2,
  FileText,
  UploadCloud,
  X,
  Sparkles,
  Circle,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeLogo } from "@/components/ThemeLogo";

const MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type StagedFile = {
  localId: string;
  file: File;
  selectedItemId: string | null;
  autoSuggested: boolean;
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
};

const KEYWORD_RULES: { keywords: string[]; matches: string[] }[] = [
  { keywords: ["w-2", "w2"], matches: ["w-2", "w2"] },
  { keywords: ["1099-nec", "1099nec"], matches: ["1099-nec", "nec"] },
  { keywords: ["1099-misc", "1099misc"], matches: ["1099-misc", "misc"] },
  { keywords: ["1099-int", "1099int"], matches: ["1099-int", "interest"] },
  { keywords: ["1099-div", "1099div"], matches: ["1099-div", "dividend"] },
  { keywords: ["1099-b", "1099b"], matches: ["1099-b", "brokerage"] },
  { keywords: ["1099-r", "1099r"], matches: ["1099-r", "retirement"] },
  { keywords: ["1099-g", "1099g"], matches: ["1099-g"] },
  { keywords: ["1099-k", "1099k"], matches: ["1099-k"] },
  { keywords: ["1098-t", "1098t"], matches: ["1098-t", "tuition"] },
  { keywords: ["1098-e", "1098e"], matches: ["1098-e", "student loan"] },
  { keywords: ["1098", "mortgage"], matches: ["1098", "mortgage"] },
  { keywords: ["5498-sa", "5498sa", "hsa"], matches: ["hsa", "5498"] },
  { keywords: ["5498"], matches: ["5498", "ira"] },
  { keywords: ["k-1", "schedulek"], matches: ["k-1"] },
  { keywords: ["property", "propertytax"], matches: ["property"] },
  { keywords: ["donation", "charitable"], matches: ["charit", "donation"] },
  { keywords: ["expense", "mileage", "ledger"], matches: ["expense", "business"] },
  { keywords: ["crypto", "coinbase", "kraken", "binance"], matches: ["crypto"] },
  { keywords: ["rental"], matches: ["rental", "real estate"] },
];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Treats any non-alphanumeric (including `_`, `.`, `-`) as a token boundary,
// so "Mortgage_1098_chase.pdf" matches "1098" but "PARENT_w2.pdf" doesn't match "rent".
function tokenMatches(name: string, keyword: string): boolean {
  const re = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegex(keyword)}(?:[^a-z0-9]|$)`,
    "i",
  );
  return re.test(name);
}

function suggestItemForFilename(
  filename: string,
  items: ClientChecklistItemView[],
): string | null {
  const name = filename.toLowerCase();
  // Only suggest items that still need a file — never re-route to already
  // received or reviewed items.
  const candidates = items.filter((i) => i.status === "needed");
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => tokenMatches(name, k))) {
      const match = candidates.find((c) => {
        const haystack = (c.title + " " + c.description).toLowerCase();
        return rule.matches.some((m) => haystack.includes(m));
      });
      if (match) return match.id;
    }
  }
  return null;
}

export default function ClientPortalPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: session, isLoading, error } = useGetClientSession();
  const exitPreview = useExitClientPreview();

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPreview = session?.mode === "admin_preview";

  const handleExitPreview = () => {
    exitPreview.mutate(undefined, {
      onSuccess: () => {
        toast.success("Preview ended");
        // Closing the tab is the friendliest UX since admins opened the preview
        // in a new window — fall back to the admin console if the browser
        // refuses to close.
        try {
          window.close();
        } catch {
          // ignore
        }
        setLocation("/admin");
      },
      onError: () => {
        toast.error("Could not end preview");
      },
    });
  };

  if (error) {
    if (error instanceof ApiError && error.status === 401) {
      setLocation("/");
      return null;
    }
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-destructive">
            Error loading session
          </h2>
          <Button onClick={() => setLocation("/")}>Return Home</Button>
        </div>
      </div>
    );
  }

  if (isLoading || !session) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const items = session.items;
  const neededItems = items.filter((i) => i.status === "needed");
  const itemsRemaining = neededItems.length;
  const progressPercent =
    session.itemsTotal === 0
      ? 0
      : Math.round((session.itemsCompleted / session.itemsTotal) * 100);

  const acceptDroppedFiles = (incoming: FileList | File[]) => {
    const files = Array.from(incoming);
    const accepted: StagedFile[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 50 MB and was skipped.`);
        continue;
      }
      const suggested = suggestItemForFilename(file.name, items);
      accepted.push({
        localId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2),
        file,
        selectedItemId: suggested,
        autoSuggested: !!suggested,
        status: "pending",
      });
    }
    if (accepted.length > 0) {
      setStaged((prev) => [...prev, ...accepted]);
      const matched = accepted.filter((s) => s.selectedItemId).length;
      const unmatched = accepted.length - matched;
      const parts: string[] = [];
      if (matched > 0) parts.push(`${matched} auto-matched`);
      if (unmatched > 0) parts.push(`${unmatched} need a label`);
      toast.success(`Added ${accepted.length} file(s). ${parts.join(", ")}.`);
    }
  };

  const updateStaged = (localId: string, patch: Partial<StagedFile>) => {
    setStaged((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)),
    );
  };

  const removeStaged = (localId: string) => {
    setStaged((prev) => prev.filter((s) => s.localId !== localId));
  };

  const clearStaged = () => setStaged([]);

  const allStagedAssigned =
    staged.length > 0 && staged.every((s) => s.selectedItemId);

  const sendAll = async () => {
    if (isPreview) {
      toast.error("Read-only admin preview — uploads are disabled.");
      return;
    }
    if (!allStagedAssigned) {
      toast.error("Choose a document type for every file before sending.");
      return;
    }
    setIsSending(true);
    let successCount = 0;
    let failCount = 0;
    for (const s of staged) {
      if (s.status === "done") continue;
      updateStaged(s.localId, { status: "uploading", errorMsg: undefined });
      try {
        const formData = new FormData();
        formData.append("file", s.file);
        const res = await fetch(
          `/api/portal/client/items/${s.selectedItemId}/upload`,
          {
            method: "POST",
            body: formData,
            credentials: "include",
          },
        );
        if (!res.ok) {
          let msg = "Upload failed";
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {}
          throw new Error(msg);
        }
        updateStaged(s.localId, { status: "done" });
        successCount++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        updateStaged(s.localId, { status: "error", errorMsg: msg });
        failCount++;
      }
    }
    setIsSending(false);
    await queryClient.invalidateQueries({
      queryKey: getGetClientSessionQueryKey(),
    });
    if (successCount > 0) {
      toast.success(
        `Sent ${successCount} file${successCount === 1 ? "" : "s"} to J.T.`,
      );
      setStaged((prev) => prev.filter((s) => s.status !== "done"));
    }
    if (failCount > 0) {
      toast.error(
        `${failCount} file${failCount === 1 ? "" : "s"} failed. Tap to retry.`,
      );
    }
  };

  const handleDelete = async (itemId: string, fileId: string) => {
    if (isPreview) {
      toast.error("Read-only admin preview — file deletes are disabled.");
      return;
    }
    try {
      const res = await fetch(
        `/api/portal/client/items/${itemId}/files/${fileId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error("Delete failed");
      toast.success("File removed");
      queryClient.invalidateQueries({
        queryKey: getGetClientSessionQueryKey(),
      });
    } catch {
      toast.error("Failed to remove file");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-24">
      {isPreview && (
        <div className="sticky top-0 z-30 bg-amber-500 text-amber-950 border-b-2 border-amber-600 shadow-md">
          <div className="container mx-auto px-4 py-2.5 max-w-4xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Eye className="h-4 w-4 shrink-0" />
              <span>
                Viewing as{" "}
                <span className="font-semibold">{session.clientFullName}</span>{" "}
                — admin preview (read-only).
                {session.adminDisplayName ? (
                  <span className="opacity-80"> Signed in as {session.adminDisplayName}.</span>
                ) : null}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-900/40 bg-amber-100 text-amber-950 hover:bg-amber-200 hover:text-amber-950 gap-1.5 h-8"
              onClick={handleExitPreview}
              disabled={exitPreview.isPending}
            >
              {exitPreview.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Exit preview
            </Button>
          </div>
        </div>
      )}
      <header className={cn(
        "border-b border-border/40 bg-card/50 backdrop-blur-sm sticky z-10",
        isPreview ? "top-[52px]" : "top-0",
      )}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-4xl">
          <ThemeLogo className="h-6 w-auto" />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Tax Year</span>
            <Badge variant="secondary" className="font-mono">
              {session.filingYear}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-4xl space-y-8">
        {/* Greeting + progress */}
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome, {session.clientFirstName}.
          </h1>
          <p className="text-muted-foreground text-lg">
            {isPreview ? (
              <>
                This is exactly what {session.clientFirstName} sees when they open
                their portal. Uploads and deletes are disabled while previewing.
              </>
            ) : itemsRemaining === 0 ? (
              <>You're all caught up — nothing left to send. Thanks!</>
            ) : (
              <>
                We still need{" "}
                <span className="text-foreground font-medium">
                  {itemsRemaining} document{itemsRemaining === 1 ? "" : "s"}
                </span>{" "}
                from you. Drop everything in one place — we'll match it up.
              </>
            )}
          </p>
          <div className="flex items-center gap-3 pt-2">
            <Progress value={progressPercent} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {session.itemsCompleted}/{session.itemsTotal}
            </span>
          </div>
        </div>

        {/* Unified drop zone — hidden entirely in admin preview */}
        {itemsRemaining > 0 && !isPreview && (
          <div
            className={cn(
              "relative rounded-2xl border-2 border-dashed transition-colors p-10 text-center",
              "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-2 focus-within:ring-offset-background",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/60 hover:bg-muted/30",
              isSending && "opacity-60 pointer-events-none",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                acceptDroppedFiles(e.dataTransfer.files);
              }
            }}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              aria-label="Upload tax documents — drop multiple files here or click to browse"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-2xl"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  acceptDroppedFiles(e.target.files);
                }
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <div className="flex flex-col items-center gap-3 pointer-events-none">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <UploadCloud className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-medium">
                  Drop your tax documents here
                </p>
                <p className="text-sm text-muted-foreground">
                  Multiple files at once is fine — we'll auto-match them by name.
                  PDF, JPG, PNG up to 50&nbsp;MB each.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Staging tray */}
        {staged.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">
                  Ready to send ({staged.length})
                </h3>
              </div>
              <button
                onClick={clearStaged}
                disabled={isSending}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Clear all
              </button>
            </div>
            <div className="divide-y divide-border/40">
              {staged.map((s) => (
                <StagedRow
                  key={s.localId}
                  staged={s}
                  needed={items.filter((i) => i.status === "needed")}
                  onChange={(itemId) =>
                    updateStaged(s.localId, {
                      selectedItemId: itemId,
                      autoSuggested: false,
                    })
                  }
                  onRemove={() => removeStaged(s.localId)}
                  disabled={isSending}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border/40 bg-muted/20">
              <p className="text-xs text-muted-foreground">
                {allStagedAssigned
                  ? "Everything is labeled — ready to send."
                  : "Pick a document type for each file before sending."}
              </p>
              <Button
                onClick={sendAll}
                disabled={!allStagedAssigned || isSending}
                size="default"
                className="gap-2"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send {staged.length} file{staged.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {/* Compact checklist */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Your checklist</h2>
            <p className="text-xs text-muted-foreground">
              {session.itemsCompleted} of {session.itemsTotal} received
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
            <div className="divide-y divide-border/40">
              {items.map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  readOnly={isPreview}
                  onDelete={(fileId) => handleDelete(item.id, fileId)}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StagedRow({
  staged,
  needed,
  onChange,
  onRemove,
  disabled,
}: {
  staged: StagedFile;
  needed: ClientChecklistItemView[];
  onChange: (itemId: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const statusIcon = useMemo(() => {
    switch (staged.status) {
      case "uploading":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "done":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <X className="h-4 w-4 text-destructive" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  }, [staged.status]);

  return (
    <div className="px-5 py-3 grid grid-cols-[auto_1fr_auto_auto] items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
        {statusIcon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{staged.file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(staged.file.size)}
          {staged.autoSuggested && staged.selectedItemId ? (
            <span className="ml-2 text-primary">· auto-matched</span>
          ) : null}
          {staged.status === "error" && staged.errorMsg ? (
            <span className="ml-2 text-destructive">· {staged.errorMsg}</span>
          ) : null}
        </p>
      </div>
      <div className="w-[220px]">
        <Select
          value={staged.selectedItemId ?? ""}
          onValueChange={onChange}
          disabled={disabled || staged.status === "done"}
        >
          <SelectTrigger
            className={cn(
              "h-9 text-xs",
              !staged.selectedItemId && "border-yellow-500/40 text-yellow-500",
            )}
          >
            <SelectValue placeholder="— Choose document —" />
          </SelectTrigger>
          <SelectContent>
            {needed.map((it) => (
              <SelectItem key={it.id} value={it.id}>
                {it.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${staged.file.name} from upload queue`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ChecklistRow({
  item,
  readOnly = false,
  onDelete,
}: {
  item: ClientChecklistItemView;
  readOnly?: boolean;
  onDelete: (fileId: string) => void;
}) {
  const isReviewed = item.status === "reviewed";
  const isUploaded = item.status === "uploaded";
  const isNeeded = item.status === "needed";
  const fileCount = item.files.length;

  return (
    <div
      className={cn(
        "px-5 py-4 transition-colors",
        isReviewed ? "bg-muted/30" : "bg-card",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="pt-0.5">
          {isReviewed ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : isUploaded ? (
            <CheckCircle2 className="h-5 w-5 text-blue-500" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3
              className={cn(
                "text-sm font-medium truncate",
                isReviewed && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </h3>
            <span className="shrink-0">
              {isReviewed ? (
                <Badge
                  variant="outline"
                  className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px] uppercase tracking-wide"
                >
                  Reviewed
                </Badge>
              ) : isUploaded ? (
                <Badge
                  variant="outline"
                  className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px] uppercase tracking-wide"
                >
                  Received
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-[10px] uppercase tracking-wide"
                >
                  Needed
                </Badge>
              )}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {item.whyWeNeedThis || item.description}
          </p>
          {fileCount > 0 && (
            <ul className="pt-2 space-y-1">
              {item.files.map((f) => (
                <li
                  key={f.driveFileId}
                  className="flex items-center justify-between gap-3 rounded-md bg-background/60 border border-border/40 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs truncate">{f.filename}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                  {!isReviewed && !readOnly && (
                    <button
                      onClick={() => onDelete(f.driveFileId)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      aria-label={`Remove ${f.filename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isNeeded && (
            <p className="text-[11px] text-muted-foreground/70 pt-1">
              Drop the file above and we'll match it to this item
              automatically.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
