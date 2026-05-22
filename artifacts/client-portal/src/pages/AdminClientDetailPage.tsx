import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminClient,
  useGenerateChecklist,
  useCreateChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  useToggleItemReviewed,
  usePublishChecklist,
  useRevokeChecklistLink,
  useSendChecklistEmail,
  useCreateAdminPreviewSession,
  getGetAdminClientQueryKey,
  getListAdminClientsQueryKey,
  getGetAdminDashboardQueryKey,
  type ChecklistItem,
  type EmailSendResult,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  FolderDot,
  Loader2,
  LogOut,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldOff,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ApiError } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeLogo } from "@/components/ThemeLogo";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const STATUS_STYLES: Record<ChecklistItem["status"], string> = {
  needed: "border-yellow-500/30 text-yellow-500 bg-yellow-500/5",
  uploaded: "border-blue-400/30 text-blue-400 bg-blue-500/5",
  reviewed: "border-green-500/30 text-green-500 bg-green-500/5",
};

const STATUS_LABELS: Record<ChecklistItem["status"], string> = {
  needed: "Needed",
  uploaded: "Uploaded",
  reviewed: "Reviewed",
};

export default function AdminClientDetailPage({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const { signOut } = useClerk();

  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useGetAdminClient(clientId, {
      query: {
        queryKey: getGetAdminClientQueryKey(clientId),
        // Poll once a minute. Mutations call invalidate() to refresh on demand,
        // so this only catches uploads that happen while J.T. is staring at
        // the page — frequent enough to feel live, infrequent enough to not
        // feel like the page is reloading.
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
      },
    });

  const generate = useGenerateChecklist();
  const publish = usePublishChecklist();
  const revoke = useRevokeChecklistLink();
  const sendEmail = useSendChecklistEmail();
  const previewSession = useCreateAdminPreviewSession();

  const [emailPreview, setEmailPreview] = useState<EmailSendResult | null>(null);
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [magicLinkExpiresAt, setMagicLinkExpiresAt] = useState<string | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) });
    queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
  };

  const errorMessage = (e: unknown, fallback: string): string => {
    if (e instanceof ApiError) {
      const data = e.data as { error?: string } | null;
      if (data?.error) return data.error;
    }
    if (e instanceof Error && e.message) return e.message;
    return fallback;
  };

  const itemsByCategory = useMemo(() => {
    if (!data) return {} as Record<string, ChecklistItem[]>;
    return data.items.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
      (acc[item.category] ||= []).push(item);
      return acc;
    }, {});
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        {error ? (
          <div className="text-center space-y-3">
            <p className="text-destructive">Failed to load client.</p>
            <Link href="/admin">
              <Button variant="outline">Back to dashboard</Button>
            </Link>
          </div>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        )}
      </div>
    );
  }

  const totalItems = data.items.length;
  const receivedItems = data.items.filter(
    (i) => i.status === "uploaded" || i.status === "reviewed",
  ).length;
  const reviewedItems = data.items.filter((i) => i.status === "reviewed").length;
  const isPublished = data.status === "published";
  const canPublish = totalItems > 0 && data.hasDriveFolder;

  const handleGenerate = () => {
    generate.mutate(
      { clientId },
      {
        onSuccess: () => {
          toast.success("AI checklist generated");
          invalidate();
        },
        onError: (e: unknown) =>
          toast.error(errorMessage(e, "Failed to generate checklist")),
      },
    );
    setConfirmRegenerate(false);
  };

  const handlePublish = (opts?: { silent?: boolean }) => {
    publish.mutate(
      { clientId },
      {
        onSuccess: (result) => {
          setMagicLink(result.magicLinkUrl);
          setMagicLinkExpiresAt(result.expiresAt);
          if (!opts?.silent) {
            toast.success("Checklist published — magic link ready");
          }
          invalidate();
        },
        onError: (e: unknown) =>
          toast.error(errorMessage(e, "Failed to publish")),
      },
    );
  };

  const handleRegenerateAndCopy = () => {
    publish.mutate(
      { clientId },
      {
        onSuccess: (result) => {
          setMagicLink(result.magicLinkUrl);
          setMagicLinkExpiresAt(result.expiresAt);
          navigator.clipboard.writeText(result.magicLinkUrl).then(
            () => toast.success("Fresh magic link copied"),
            () => toast.success("Fresh magic link ready"),
          );
          invalidate();
        },
        onError: (e: unknown) =>
          toast.error(errorMessage(e, "Failed to regenerate link")),
      },
    );
  };

  const handleRevoke = () => {
    revoke.mutate(
      { clientId },
      {
        onSuccess: () => {
          setMagicLink(null);
          setMagicLinkExpiresAt(null);
          toast.success("Magic link revoked");
          invalidate();
        },
        onError: () => toast.error("Failed to revoke link"),
      },
    );
    setConfirmRevoke(false);
  };

  const handlePreview = () => {
    previewSession.mutate(
      { clientId },
      {
        onSuccess: (result) => {
          toast.success(`Opening preview as ${result.clientName}`);
          window.open(result.previewUrl, "_blank", "noopener,noreferrer");
        },
        onError: (e: unknown) =>
          toast.error(errorMessage(e, "Failed to open preview")),
      },
    );
  };

  const handleSendEmail = () => {
    sendEmail.mutate(
      { clientId },
      {
        onSuccess: (result) => {
          setEmailPreview(result);
          invalidate();
        },
        onError: (e: unknown) =>
          toast.error(errorMessage(e, "Failed to send email")),
      },
    );
  };

  const copyLink = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Magic link copied"),
      () => toast.error("Could not copy"),
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/40 bg-card/30 backdrop-blur-md sticky top-0 z-20">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="text-muted-foreground gap-2">
                <ArrowLeft className="h-4 w-4" /> Roster
              </Button>
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <ThemeLogo className="h-6" />
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-muted-foreground">
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 border-border/50 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-2xl tracking-tight">{data.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        isPublished
                          ? "border-primary/40 text-primary bg-primary/5"
                          : "border-yellow-500/30 text-yellow-500 bg-yellow-500/5"
                      }
                    >
                      {isPublished ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <CardDescription className="text-base">{data.email}</CardDescription>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {data.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                    <Badge variant="outline" className="text-xs gap-1">
                      <FolderDot
                        className={cn(
                          "h-3 w-3",
                          data.hasDriveFolder ? "text-green-500" : "text-muted-foreground/40",
                        )}
                      />
                      {data.hasDriveFolder ? "Drive folder ready" : "No Drive folder"}
                    </Badge>
                    <Badge variant="outline" className="text-xs">Tax year {data.filingYear}</Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            {data.priorReturnSummary && (
              <CardContent className="pt-0">
                <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Prior return notes
                  </p>
                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {data.priorReturnSummary}
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                This intake
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Items" value={totalItems} />
                <Stat label="Received" value={receivedItems} accent="text-primary" />
                <Stat label="Reviewed" value={reviewedItems} accent="text-green-500" />
              </div>
              {isPublished && data.publishedAt && (
                <p className="text-xs text-muted-foreground text-center">
                  Published {formatDistanceToNow(new Date(data.publishedAt), { addSuffix: true })}
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {!isPublished && (
            <Button
              onClick={() => (totalItems > 0 ? setConfirmRegenerate(true) : handleGenerate())}
              disabled={generate.isPending}
              className="gap-2"
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {totalItems > 0 ? "Regenerate AI checklist" : "Generate AI checklist"}
            </Button>
          )}
          {!isPublished && (
            <Button
              onClick={() => handlePublish()}
              disabled={publish.isPending || !canPublish}
              variant="outline"
              className="gap-2 border-primary/40 text-primary hover:text-primary"
            >
              {publish.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Publish
            </Button>
          )}
          {isPublished && (
            <>
              <Button onClick={handleSendEmail} disabled={sendEmail.isPending} className="gap-2">
                {sendEmail.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send magic link
              </Button>
              <Button
                onClick={() => setConfirmRevoke(true)}
                disabled={revoke.isPending}
                variant="outline"
                className="gap-2 border-destructive/40 text-destructive hover:text-destructive"
              >
                <ShieldOff className="h-4 w-4" />
                Revoke link
              </Button>
            </>
          )}
          <Button
            onClick={handlePreview}
            disabled={previewSession.isPending}
            variant="outline"
            className="gap-2"
            title="Open this client's portal as a read-only admin preview"
          >
            {previewSession.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            View as client
          </Button>
          {!data.hasDriveFolder && !isPublished && (
            <span className="text-xs text-yellow-500 ml-2">
              Add a Drive folder in Notion before publishing.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <LiveIndicator
              lastUpdatedAt={dataUpdatedAt}
              isFetching={isFetching}
            />
            <Button
              onClick={() => refetch()}
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              disabled={isFetching}
              aria-label="Refresh now"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </section>

        {(isPublished || magicLink) && (
          <Card className="border-primary/30 bg-primary/5 shadow-sm">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs uppercase tracking-wider text-primary">
                    Magic link
                    {(magicLinkExpiresAt ?? data.magicLinkExpiresAt)
                      ? ` · expires ${formatDistanceToNow(
                          new Date(
                            (magicLinkExpiresAt ?? data.magicLinkExpiresAt)!,
                          ),
                          { addSuffix: true },
                        )}`
                      : ""}
                  </p>
                  {magicLink ? (
                    <p className="text-sm font-mono truncate text-foreground">
                      {magicLink}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      An active magic link exists for {data.name.split(" ")[0]}.
                      For security, the URL is not stored — regenerate to get a
                      fresh copyable link (the previous one will be revoked).
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {magicLink && (
                    <Button
                      onClick={() => copyLink(magicLink)}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  )}
                  <Button
                    onClick={handleRegenerateAndCopy}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={publish.isPending || !canPublish}
                  >
                    {publish.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Regenerate &amp; copy
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Checklist</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsAddingItem(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>

          {totalItems === 0 ? (
            <Card className="border-dashed border-border/60 bg-card/40">
              <CardContent className="py-12 flex flex-col items-center text-center gap-3">
                <Sparkles className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">No checklist yet</p>
                  <p className="text-sm text-muted-foreground">
                    Generate one from {data.name.split(" ")[0]}'s prior return — or add items manually.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {Object.entries(itemsByCategory).map(([category, items]) => (
                <div key={category} className="space-y-3">
                  <h3 className="text-sm uppercase tracking-wider text-muted-foreground">
                    {category}
                  </h3>
                  <div className="grid gap-3">
                    {items.map((item) => (
                      <ChecklistRow
                        key={item.id}
                        item={item}
                        clientId={clientId}
                        readOnly={false}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <AddItemDialog
        open={isAddingItem}
        onOpenChange={setIsAddingItem}
        clientId={clientId}
        nextPosition={totalItems}
      />

      <Dialog
        open={!!emailPreview}
        onOpenChange={(open) => !open && setEmailPreview(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> Email sent (mock)
            </DialogTitle>
            <DialogDescription>
              Sent to <span className="text-foreground">{emailPreview?.recipient}</span> — preview below.
            </DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap text-sm bg-muted/40 border border-border/40 rounded-md p-4 max-h-80 overflow-y-auto font-sans leading-relaxed">
            {emailPreview?.previewBody ?? ""}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this magic link?</AlertDialogTitle>
            <AlertDialogDescription>
              {data.name} will no longer be able to access the portal with the current link. You can
              publish again to issue a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the entire checklist?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every item currently on the draft and starts over from the prior-return summary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerate}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LiveIndicator({
  lastUpdatedAt,
  isFetching,
}: {
  lastUpdatedAt: number;
  isFetching: boolean;
}) {
  // Re-render every 10s so the "synced Xs ago" label stays current without
  // touching network state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!lastUpdatedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
  const label =
    seconds < 5
      ? "just now"
      : seconds < 60
        ? `${seconds}s ago`
        : `${Math.round(seconds / 60)}m ago`;
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
      title={`Auto-refreshes every minute. Last sync: ${new Date(lastUpdatedAt).toLocaleTimeString()}.`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isFetching ? "bg-primary animate-pulse" : "bg-green-500/70",
        )}
      />
      <span>Live · {label}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="space-y-1">
      <div className={cn("text-2xl font-semibold tabular-nums", accent ?? "text-foreground")}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ChecklistRow({
  item,
  clientId,
}: {
  item: ChecklistItem;
  clientId: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateItem = useUpdateChecklistItem();
  const deleteItem = useDeleteChecklistItem();
  const toggleReviewed = useToggleItemReviewed();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) });
    queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
  };

  const handleToggleReviewed = (checked: boolean) => {
    toggleReviewed.mutate(
      { itemId: item.id, data: { reviewed: checked } },
      {
        onSuccess: () => invalidate(),
        onError: () => toast.error("Failed to update review status"),
      },
    );
  };

  const handleDelete = () => {
    deleteItem.mutate(
      { itemId: item.id },
      {
        onSuccess: () => {
          toast.success("Item removed");
          invalidate();
        },
        onError: () => toast.error("Failed to delete item"),
      },
    );
    setConfirmDelete(false);
  };

  return (
    <Card className="border-border/50 shadow-sm overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-start gap-3 p-4">
          <Checkbox
            checked={item.status === "reviewed"}
            onCheckedChange={(checked) => handleToggleReviewed(!!checked)}
            disabled={item.files.length === 0}
            className="mt-1"
            aria-label="Mark reviewed"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground truncate">{item.title}</span>
              <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[item.status])}>
                {STATUS_LABELS[item.status]}
              </Badge>
              {item.files.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {item.files.length} file{item.files.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
              {item.description}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setIsEditing(true);
                setOpen(true);
              }}
              aria-label="Edit item"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Toggle details"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    open ? "rotate-180" : "rotate-0",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <Separator />
          <div className="p-4 space-y-4 bg-muted/10">
            {isEditing ? (
              <EditItemForm
                item={item}
                onCancel={() => setIsEditing(false)}
                onSave={(data) => {
                  updateItem.mutate(
                    { itemId: item.id, data },
                    {
                      onSuccess: () => {
                        toast.success("Item updated");
                        invalidate();
                        setIsEditing(false);
                      },
                      onError: () => toast.error("Failed to update item"),
                    },
                  );
                }}
                isSaving={updateItem.isPending}
              />
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Description
                    </p>
                    <p className="text-sm text-foreground/90">{item.description}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Why we need this
                    </p>
                    <p className="text-sm text-foreground/90">{item.whyWeNeedThis}</p>
                  </div>
                </div>
                {item.files.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Files received
                    </p>
                    <div className="grid gap-2">
                      {item.files.map((f) => (
                        <a
                          key={f.driveFileId}
                          href={f.driveFileUrl ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-background/60 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{f.filename}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(f.size)} ·{" "}
                                {formatDistanceToNow(new Date(f.uploadedAt), {
                                  addSuffix: true,
                                })}
                              </p>
                            </div>
                          </div>
                          {item.status === "reviewed" && (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {item.files.length > 0
                ? `This item has ${item.files.length} uploaded file${item.files.length === 1 ? "" : "s"}. The metadata will be removed; underlying Drive files are not deleted.`
                : "This will remove the item from the checklist."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function EditItemForm({
  item,
  onCancel,
  onSave,
  isSaving,
}: {
  item: ChecklistItem;
  onCancel: () => void;
  onSave: (data: {
    title: string;
    description: string;
    category: string;
    whyWeNeedThis: string;
  }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [whyWeNeedThis, setWhyWeNeedThis] = useState(item.whyWeNeedThis);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, description, category, whyWeNeedThis });
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={2}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Why we need this
        </Label>
        <Textarea
          value={whyWeNeedThis}
          onChange={(e) => setWhyWeNeedThis(e.target.value)}
          required
          rows={2}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function AddItemDialog({
  open,
  onOpenChange,
  clientId,
  nextPosition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  nextPosition: number;
}) {
  const queryClient = useQueryClient();
  const create = useCreateChecklistItem();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [whyWeNeedThis, setWhyWeNeedThis] = useState("");

  const reset = () => {
    setTitle("");
    setDescription("");
    setCategory("");
    setWhyWeNeedThis("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        clientId,
        data: { title, description, category, whyWeNeedThis, position: nextPosition },
      },
      {
        onSuccess: () => {
          toast.success("Item added");
          queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) });
          reset();
          onOpenChange(false);
        },
        onError: () => toast.error("Failed to add item"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a checklist item</DialogTitle>
          <DialogDescription>
            Drop in a custom document request. The client will see it on their checklist.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. K-1 from Acme LLC"
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                placeholder="e.g. Income"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={2}
              placeholder="What you need from them, in plain English."
            />
          </div>
          <div className="space-y-1">
            <Label>Why we need this</Label>
            <Textarea
              value={whyWeNeedThis}
              onChange={(e) => setWhyWeNeedThis(e.target.value)}
              required
              rows={2}
              placeholder="A short explainer the client can read if they're confused."
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
