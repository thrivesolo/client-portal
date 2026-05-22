import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ApiError, useGetAdminDashboard, useListAdminClients, useSyncAdminClients, useCreateAdminPreviewSession, useCreateAdminClient, getListAdminClientsQueryKey, getGetAdminDashboardQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Search, Users, CheckCircle2, Clock, LogOut, FileText, UploadCloud, FolderDot, Eye, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeLogo } from "@/components/ThemeLogo";

export default function AdminDashboardPage() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: dashboard, isLoading: isDashLoading, error: dashError, dataUpdatedAt: dashUpdatedAt, isFetching: isDashFetching } = useGetAdminDashboard({
    query: {
      queryKey: getGetAdminDashboardQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      retry: false,
    },
  });
  const { data: clients, isLoading: isClientsLoading, error: clientsError, dataUpdatedAt: clientsUpdatedAt, isFetching: isClientsFetching } = useListAdminClients({
    query: {
      queryKey: getListAdminClientsQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      retry: false,
    },
  });
  const lastUpdated = Math.max(dashUpdatedAt ?? 0, clientsUpdatedAt ?? 0);
  const isFetching = isDashFetching || isClientsFetching;
  const syncClients = useSyncAdminClients();
  const createClient = useCreateAdminClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDriveFolderId, setNewDriveFolderId] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newPriorReturnSummary, setNewPriorReturnSummary] = useState("");

  const resetAddForm = () => {
    setNewName("");
    setNewEmail("");
    setNewDriveFolderId("");
    setNewTags("");
    setNewPriorReturnSummary("");
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email) {
      toast.error("Name and email are required.");
      return;
    }
    const tags = newTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    createClient.mutate(
      {
        data: {
          name,
          email,
          driveFolderId: newDriveFolderId.trim() || null,
          priorReturnSummary: newPriorReturnSummary.trim() || null,
          tags,
        },
      },
      {
        onSuccess: (data) => {
          toast.success(`Created client ${data.name}`);
          queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          resetAddForm();
          setAddOpen(false);
        },
        onError: (err: unknown) => {
          const message =
            err instanceof ApiError
              ? ((err.data as { error?: string } | null)?.error ?? err.message)
              : err instanceof Error
                ? err.message
                : "Failed to create client";
          toast.error(message);
        },
      },
    );
  };

  const previewSession = useCreateAdminPreviewSession();
  const [previewingClientId, setPreviewingClientId] = useState<string | null>(null);

  // Surface 403 from the admin API so admins immediately see why the roster is
  // empty (almost always: their email isn't in ADMIN_EMAIL_ALLOWLIST).
  const forbidden =
    (dashError instanceof ApiError && dashError.status === 403) ||
    (clientsError instanceof ApiError && clientsError.status === 403);
  const forbiddenMessage = (() => {
    const e =
      dashError instanceof ApiError ? dashError :
      clientsError instanceof ApiError ? clientsError : null;
    if (!e) return null;
    const data = e.data as { error?: string } | null;
    return data?.error ?? null;
  })();

  const handlePreview = (clientId: string, clientName: string) => {
    setPreviewingClientId(clientId);
    previewSession.mutate(
      { clientId },
      {
        onSuccess: (data) => {
          toast.success(`Opening preview as ${data.clientName}`);
          window.open(data.previewUrl, "_blank", "noopener,noreferrer");
        },
        onError: (e: unknown) => {
          const message =
            e instanceof ApiError
              ? ((e.data as { error?: string } | null)?.error ?? e.message)
              : e instanceof Error
                ? e.message
                : `Failed to open preview for ${clientName}`;
          toast.error(message);
        },
        onSettled: () => setPreviewingClientId(null),
      },
    );
  };

  const handleSync = () => {
    syncClients.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(`Synced ${data.synced} clients from ${data.source}`);
        queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
      },
      onError: () => toast.error("Failed to sync clients")
    });
  };

  const filteredClients = clients?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.email.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (isDashLoading || isClientsLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (forbidden) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <header className="border-b border-border/40 bg-card/30 backdrop-blur-md">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <ThemeLogo className="h-6" />
              <span className="font-semibold text-lg text-primary tracking-tight">Admin Console</span>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-muted-foreground">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </Button>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-16 max-w-2xl">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader className="flex flex-row items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <CardTitle className="text-destructive text-lg">Admin access not configured</CardTitle>
                <CardDescription className="text-foreground/80">
                  {forbiddenMessage ??
                    "Your account isn't on the admin allowlist. Add your Clerk email to ADMIN_EMAIL_ALLOWLIST and restart the API server."}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Once your email is added, refresh this page — the roster and dashboard
              stats will load automatically.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/40 bg-card/30 backdrop-blur-md sticky top-0 z-20">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ThemeLogo className="h-6" />
            <span className="font-semibold text-lg text-primary tracking-tight">Admin Console</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-muted-foreground">
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border/50 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Clients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard?.totalClients || 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Sessions</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard?.publishedSessions || 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Items Received</CardTitle>
              <UploadCloud className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{dashboard?.itemsReceived || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">of {dashboard?.itemsNeeded || 0} needed</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Reviewed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{dashboard?.itemsReviewed || 0}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
            <div>
              <CardTitle className="text-xl">Client Roster</CardTitle>
              <CardDescription>Manage sessions and documents across your client base.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveIndicator
                lastUpdatedAt={lastUpdated}
                isFetching={isFetching}
              />
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-background/50 border-border/50"
                />
              </div>
              <Button onClick={handleSync} disabled={syncClients.isPending} variant="outline" className="gap-2 border-border/50 bg-background/50">
                <RefreshCw className={`h-4 w-4 ${syncClients.isPending ? 'animate-spin' : ''}`} />
                Sync Notion
              </Button>
              <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm(); }}>
                <DialogTrigger asChild>
                  <Button className="gap-2" data-testid="button-add-client">
                    <UserPlus className="h-4 w-4" />
                    Add Client
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Add a new client</DialogTitle>
                    <DialogDescription>
                      Manually create a client for testing. They won't be synced from Notion.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateClient} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-client-name">Name<span className="text-destructive"> *</span></Label>
                      <Input
                        id="new-client-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Jane Doe"
                        required
                        data-testid="input-new-client-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-client-email">Email<span className="text-destructive"> *</span></Label>
                      <Input
                        id="new-client-email"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="jane@example.com"
                        required
                        data-testid="input-new-client-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-client-tags">Tags (comma separated)</Label>
                      <Input
                        id="new-client-tags"
                        value={newTags}
                        onChange={(e) => setNewTags(e.target.value)}
                        placeholder="self-employed, new-client"
                        data-testid="input-new-client-tags"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-client-drive">Drive folder ID (optional)</Label>
                      <Input
                        id="new-client-drive"
                        value={newDriveFolderId}
                        onChange={(e) => setNewDriveFolderId(e.target.value)}
                        placeholder="Google Drive folder ID"
                        data-testid="input-new-client-drive"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-client-prior">Prior return summary (optional)</Label>
                      <Textarea
                        id="new-client-prior"
                        value={newPriorReturnSummary}
                        onChange={(e) => setNewPriorReturnSummary(e.target.value)}
                        placeholder="Notes about prior filings…"
                        rows={3}
                        data-testid="input-new-client-prior"
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} disabled={createClient.isPending}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createClient.isPending} data-testid="button-submit-new-client">
                        {createClient.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Create client
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow className="border-border/40 hover:bg-transparent">
                  <TableHead>Client Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Drive</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow 
                    key={client.id} 
                    className="cursor-pointer border-border/40 hover:bg-muted/30 transition-colors group"
                    onClick={() => setLocation(`/admin/clients/${client.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground group-hover:text-primary transition-colors">{client.name}</div>
                      <div className="text-xs text-muted-foreground">{client.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        client.status === 'published' ? 'border-primary/30 text-primary bg-primary/5' :
                        client.status === 'draft' ? 'border-yellow-500/30 text-yellow-500 bg-yellow-500/5' :
                        'border-muted-foreground/30 text-muted-foreground bg-muted/20'
                      }>
                        {client.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {client.itemsTotal > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono">{client.itemsReceived}/{client.itemsTotal}</span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${(client.itemsReceived / client.itemsTotal) * 100}%` }} />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.hasDriveFolder ? (
                        <FolderDot className="h-4 w-4 text-green-500" />
                      ) : (
                        <FolderDot className="h-4 w-4 text-muted-foreground/30" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.lastUploadAt ? formatDistanceToNow(new Date(client.lastUploadAt), { addSuffix: true }) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-xs text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(client.id, client.name);
                        }}
                        disabled={previewSession.isPending && previewingClientId === client.id}
                        aria-label={`View portal as ${client.name}`}
                      >
                        {previewSession.isPending && previewingClientId === client.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        View as client
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredClients.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No clients found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
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
        className={`h-1.5 w-1.5 rounded-full ${isFetching ? "bg-primary animate-pulse" : "bg-green-500/70"}`}
      />
      <span>Live · {label}</span>
    </div>
  );
}
