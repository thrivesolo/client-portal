import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import {
  db,
  clientsTable,
  intakeSessionsTable,
  checklistItemsTable,
  magicLinkTokensTable,
  uploadAuditLogTable,
  adminUsersTable,
} from "@workspace/db";
import {
  ListAdminClientsResponse,
  GetAdminClientParams,
  GetAdminClientResponse,
  GenerateChecklistParams,
  GenerateChecklistResponse,
  CreateChecklistItemParams,
  CreateChecklistItemBody,
  UpdateChecklistItemParams,
  UpdateChecklistItemBody,
  UpdateChecklistItemResponse,
  DeleteChecklistItemParams,
  ToggleItemReviewedParams,
  ToggleItemReviewedBody,
  ToggleItemReviewedResponse,
  PublishChecklistParams,
  PublishChecklistResponse,
  RevokeChecklistLinkParams,
  SendChecklistEmailParams,
  SendChecklistEmailResponse,
  SyncAdminClientsResponse,
  GetAdminDashboardResponse,
  CreateAdminClientBody,
} from "@workspace/api-zod";
import {
  generateMockChecklist,
  getMockNotionClients,
  mockGmailSend,
} from "../../lib/mockServices";
import {
  generateRawToken,
  hashToken,
  revokePortalSessionsForIntake,
  createAdminPreviewSession,
  setPortalSessionCookie,
  ADMIN_PREVIEW_TTL_MS,
} from "../../lib/portalSession";
import {
  CreateAdminPreviewSessionParams,
  CreateAdminPreviewSessionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function adminEmailAllowlist(): string[] {
  const raw = process.env.ADMIN_EMAIL_ALLOWLIST ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const allowlist = adminEmailAllowlist();
    if (allowlist.length === 0) {
      req.log?.error?.(
        "ADMIN_EMAIL_ALLOWLIST is empty — refusing all admin requests.",
      );
      res
        .status(403)
        .json({ error: "Admin allowlist not configured on the server." });
      return;
    }
    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(userId);
    } catch (e: unknown) {
      req.log?.error?.({ err: e }, "Failed to load Clerk user");
      res.status(403).json({ error: "Unable to verify admin identity." });
      return;
    }
    const primaryEmailId = clerkUser.primaryEmailAddressId;
    const primaryEmailObj = clerkUser.emailAddresses.find(
      (entry) => entry.id === primaryEmailId,
    );
    const email = primaryEmailObj?.emailAddress?.toLowerCase() ?? null;
    if (!email || !allowlist.includes(email)) {
      res.status(403).json({ error: "Not an authorized admin." });
      return;
    }
    const fullName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      null;
    await db
      .insert(adminUsersTable)
      .values({
        clerkUserId: userId,
        email,
        name: fullName,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: adminUsersTable.clerkUserId,
        set: { email, name: fullName, lastSeenAt: new Date() },
      });
    next();
  })().catch(next);
};

router.use(requireAdmin);

const CURRENT_FILING_YEAR = 2025;

function paramId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildMagicLinkUrl(req: Request, rawToken: string): string {
  const proto =
    headerString(req.headers["x-forwarded-proto"]) ?? req.protocol ?? "https";
  const host =
    headerString(req.headers["x-forwarded-host"]) ??
    headerString(req.headers.host) ??
    "";
  return `${proto}://${host}/portal/?t=${encodeURIComponent(rawToken)}`;
}

async function assertSessionEditable(
  res: Response,
  intakeSessionId: string,
): Promise<boolean> {
  const [session] = await db
    .select()
    .from(intakeSessionsTable)
    .where(eq(intakeSessionsTable.id, intakeSessionId));
  if (!session) {
    res.status(404).json({ error: "Intake session not found." });
    return false;
  }
  if (session.status === "published") {
    res.status(409).json({
      error:
        "This checklist is published and locked. Revoke the magic link before editing.",
    });
    return false;
  }
  return true;
}

async function ensureCurrentSession(clientId: string) {
  const [existing] = await db
    .select()
    .from(intakeSessionsTable)
    .where(
      and(
        eq(intakeSessionsTable.clientId, clientId),
        eq(intakeSessionsTable.filingYear, CURRENT_FILING_YEAR),
      ),
    );
  if (existing) return existing;
  const [created] = await db
    .insert(intakeSessionsTable)
    .values({
      clientId,
      filingYear: CURRENT_FILING_YEAR,
      status: "draft",
    })
    .returning();
  return created;
}

async function syncFromNotion(): Promise<number> {
  const mock = getMockNotionClients();
  for (const c of mock) {
    await db
      .insert(clientsTable)
      .values({
        notionPageId: c.notionPageId,
        name: c.name,
        email: c.email,
        driveFolderId: c.driveFolderId,
        priorReturnSummary: c.priorReturnSummary,
        tags: c.tags,
      })
      .onConflictDoUpdate({
        target: clientsTable.notionPageId,
        set: {
          name: c.name,
          email: c.email,
          driveFolderId: c.driveFolderId,
          priorReturnSummary: c.priorReturnSummary,
          tags: c.tags,
          syncedAt: new Date(),
        },
      });
  }
  return mock.length;
}

router.post("/admin/clients", async (req, res): Promise<void> => {
  const body = CreateAdminClientBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const email = body.data.email.trim().toLowerCase();
  const name = body.data.name.trim();
  if (!name || !email) {
    res.status(400).json({ error: "Name and email are required." });
    return;
  }
  const [existing] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.email, email));
  if (existing) {
    res
      .status(409)
      .json({ error: "A client with this email already exists." });
    return;
  }
  const notionPageId = `manual:${crypto.randomUUID()}`;
  const [created] = await db
    .insert(clientsTable)
    .values({
      notionPageId,
      name,
      email,
      driveFolderId: body.data.driveFolderId ?? null,
      priorReturnSummary: body.data.priorReturnSummary ?? null,
      tags: body.data.tags ?? [],
    })
    .returning();
  res.status(201).json({
    id: created.id,
    name: created.name,
    email: created.email,
    tags: created.tags,
    hasDriveFolder: !!created.driveFolderId,
    itemsTotal: 0,
    itemsReceived: 0,
    itemsReviewed: 0,
    status: "no_session" as const,
    lastUploadAt: null,
    publishedAt: null,
  });
});

router.post("/admin/clients/sync", async (req, res): Promise<void> => {
  const synced = await syncFromNotion();
  res.json(
    SyncAdminClientsResponse.parse({
      synced,
      source: "mock",
    }),
  );
});

router.get("/admin/clients", async (req, res): Promise<void> => {
  const allClients = await db
    .select()
    .from(clientsTable)
    .orderBy(clientsTable.name);

  if (allClients.length === 0) {
    await syncFromNotion();
  }

  const refreshed = allClients.length === 0
    ? await db.select().from(clientsTable).orderBy(clientsTable.name)
    : allClients;

  const summaries = await Promise.all(
    refreshed.map(async (client) => {
      const [session] = await db
        .select()
        .from(intakeSessionsTable)
        .where(
          and(
            eq(intakeSessionsTable.clientId, client.id),
            eq(intakeSessionsTable.filingYear, CURRENT_FILING_YEAR),
          ),
        );

      let itemsTotal = 0;
      let itemsReceived = 0;
      let itemsReviewed = 0;
      let lastUploadAt: string | null = null;

      if (session) {
        const items = await db
          .select()
          .from(checklistItemsTable)
          .where(eq(checklistItemsTable.intakeSessionId, session.id));
        itemsTotal = items.length;
        itemsReceived = items.filter(
          (i) => i.status === "uploaded" || i.status === "reviewed",
        ).length;
        itemsReviewed = items.filter((i) => i.status === "reviewed").length;

        const [latest] = await db
          .select({ at: uploadAuditLogTable.createdAt })
          .from(uploadAuditLogTable)
          .where(eq(uploadAuditLogTable.intakeSessionId, session.id))
          .orderBy(desc(uploadAuditLogTable.createdAt))
          .limit(1);
        if (latest?.at) {
          lastUploadAt = latest.at.toISOString();
        }
      }

      return {
        id: client.id,
        name: client.name,
        email: client.email,
        tags: client.tags,
        hasDriveFolder: !!client.driveFolderId,
        itemsTotal,
        itemsReceived,
        itemsReviewed,
        status: session ? session.status : ("no_session" as const),
        lastUploadAt,
        publishedAt: session?.publishedAt
          ? session.publishedAt.toISOString()
          : null,
      };
    }),
  );

  res.json(ListAdminClientsResponse.parse(summaries));
});

router.get("/admin/dashboard", async (req, res): Promise<void> => {
  const [{ totalClients }] = await db
    .select({ totalClients: sql<number>`count(*)::int` })
    .from(clientsTable);

  const [{ publishedSessions }] = await db
    .select({ publishedSessions: sql<number>`count(*)::int` })
    .from(intakeSessionsTable)
    .where(eq(intakeSessionsTable.status, "published"));

  const itemCounts = await db
    .select({
      status: checklistItemsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(checklistItemsTable)
    .groupBy(checklistItemsTable.status);

  let itemsNeeded = 0;
  let itemsReceived = 0;
  let itemsReviewed = 0;
  for (const row of itemCounts) {
    if (row.status === "needed") itemsNeeded = row.count;
    if (row.status === "uploaded") itemsReceived = row.count;
    if (row.status === "reviewed") itemsReviewed = row.count;
  }

  const recent = await db
    .select({
      clientId: clientsTable.id,
      clientName: clientsTable.name,
      filename: uploadAuditLogTable.filename,
      uploadedAt: uploadAuditLogTable.createdAt,
    })
    .from(uploadAuditLogTable)
    .innerJoin(
      intakeSessionsTable,
      eq(intakeSessionsTable.id, uploadAuditLogTable.intakeSessionId),
    )
    .innerJoin(clientsTable, eq(clientsTable.id, intakeSessionsTable.clientId))
    .orderBy(desc(uploadAuditLogTable.createdAt))
    .limit(10);

  res.json(
    GetAdminDashboardResponse.parse({
      totalClients,
      publishedSessions,
      itemsNeeded,
      itemsReceived,
      itemsReviewed,
      recentActivity: recent.map((r) => ({
        clientId: r.clientId,
        clientName: r.clientName,
        filename: r.filename,
        uploadedAt: r.uploadedAt.toISOString(),
      })),
    }),
  );
});

async function buildClientDetail(_req: Request, clientId: string) {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return null;
  const session = await ensureCurrentSession(clientId);
  const items = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.intakeSessionId, session.id))
    .orderBy(checklistItemsTable.position, checklistItemsTable.createdAt);

  let magicLinkExpiresAt: string | null = null;
  if (session.status === "published") {
    const [token] = await db
      .select()
      .from(magicLinkTokensTable)
      .where(
        and(
          eq(magicLinkTokensTable.intakeSessionId, session.id),
          isNull(magicLinkTokensTable.revokedAt),
        ),
      )
      .orderBy(desc(magicLinkTokensTable.createdAt))
      .limit(1);
    if (token && token.expiresAt > new Date()) {
      magicLinkExpiresAt = token.expiresAt.toISOString();
    }
  }

  return {
    id: client.id,
    name: client.name,
    email: client.email,
    tags: client.tags,
    hasDriveFolder: !!client.driveFolderId,
    priorReturnSummary: client.priorReturnSummary,
    filingYear: session.filingYear,
    status: session.status,
    publishedAt: session.publishedAt?.toISOString() ?? null,
    magicLinkUrl: null,
    magicLinkExpiresAt,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      category: i.category,
      whyWeNeedThis: i.whyWeNeedThis,
      position: i.position,
      status: i.status,
      files: (i.files ?? []).map((f) => ({
        ...f,
        driveFileUrl: f.driveFileUrl ?? null,
      })),
    })),
  };
}

router.get("/admin/clients/:clientId", async (req, res): Promise<void> => {
  const params = GetAdminClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await buildClientDetail(req, params.data.clientId);
  if (!detail) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(GetAdminClientResponse.parse(detail));
});

router.post(
  "/admin/clients/:clientId/generate-checklist",
  async (req, res): Promise<void> => {
    const params = GenerateChecklistParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const session = await ensureCurrentSession(client.id);
    if (session.status === "published") {
      res
        .status(409)
        .json({ error: "This checklist has already been published. Revoke first." });
      return;
    }
    await db
      .delete(checklistItemsTable)
      .where(eq(checklistItemsTable.intakeSessionId, session.id));

    const generated = generateMockChecklist({
      priorReturnSummary: client.priorReturnSummary,
      tags: client.tags,
    });
    if (generated.length > 0) {
      await db.insert(checklistItemsTable).values(
        generated.map((g, idx) => ({
          intakeSessionId: session.id,
          title: g.title,
          description: g.description,
          category: g.category,
          whyWeNeedThis: g.whyWeNeedThis,
          position: idx,
          status: "needed" as const,
          files: [],
        })),
      );
    }
    const detail = await buildClientDetail(req, client.id);
    res.json(GenerateChecklistResponse.parse(detail));
  },
);

router.post("/admin/clients/:clientId/items", async (req, res): Promise<void> => {
  const params = CreateChecklistItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateChecklistItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const session = await ensureCurrentSession(params.data.clientId);
  if (!(await assertSessionEditable(res, session.id))) return;
  const [{ maxPos }] = await db
    .select({
      maxPos: sql<number>`coalesce(max(${checklistItemsTable.position}), -1)::int`,
    })
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.intakeSessionId, session.id));
  const [item] = await db
    .insert(checklistItemsTable)
    .values({
      intakeSessionId: session.id,
      title: body.data.title,
      description: body.data.description,
      category: body.data.category,
      whyWeNeedThis: body.data.whyWeNeedThis,
      position: body.data.position ?? maxPos + 1,
      status: "needed" as const,
      files: [],
    })
    .returning();
  res.status(201).json({
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    whyWeNeedThis: item.whyWeNeedThis,
    position: item.position,
    status: item.status,
    files: [],
  });
});

router.patch("/admin/items/:itemId", async (req, res): Promise<void> => {
  const params = UpdateChecklistItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateChecklistItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.id, params.data.itemId));
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!(await assertSessionEditable(res, existing.intakeSessionId))) return;
  const [item] = await db
    .update(checklistItemsTable)
    .set(body.data)
    .where(eq(checklistItemsTable.id, params.data.itemId))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(
    UpdateChecklistItemResponse.parse({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      whyWeNeedThis: item.whyWeNeedThis,
      position: item.position,
      status: item.status,
      files: (item.files ?? []).map((f) => ({
        ...f,
        driveFileUrl: f.driveFileUrl ?? null,
      })),
    }),
  );
});

router.delete("/admin/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteChecklistItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.id, params.data.itemId));
  if (!existing) {
    res.sendStatus(204);
    return;
  }
  if (!(await assertSessionEditable(res, existing.intakeSessionId))) return;
  await db
    .delete(checklistItemsTable)
    .where(eq(checklistItemsTable.id, params.data.itemId));
  res.sendStatus(204);
});

router.post("/admin/items/:itemId/review", async (req, res): Promise<void> => {
  const params = ToggleItemReviewedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ToggleItemReviewedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [current] = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.id, params.data.itemId));
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const newStatus = body.data.reviewed
    ? "reviewed"
    : (current.files?.length ?? 0) > 0
      ? "uploaded"
      : "needed";
  const [item] = await db
    .update(checklistItemsTable)
    .set({ status: newStatus })
    .where(eq(checklistItemsTable.id, params.data.itemId))
    .returning();
  res.json(
    ToggleItemReviewedResponse.parse({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      whyWeNeedThis: item.whyWeNeedThis,
      position: item.position,
      status: item.status,
      files: (item.files ?? []).map((f) => ({
        ...f,
        driveFileUrl: f.driveFileUrl ?? null,
      })),
    }),
  );
});

router.post(
  "/admin/clients/:clientId/publish",
  async (req, res): Promise<void> => {
    const params = PublishChecklistParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (!client.driveFolderId) {
      res
        .status(400)
        .json({ error: "Client has no Drive folder configured in Notion." });
      return;
    }
    const session = await ensureCurrentSession(client.id);
    const items = await db
      .select()
      .from(checklistItemsTable)
      .where(eq(checklistItemsTable.intakeSessionId, session.id));
    if (items.length === 0) {
      res.status(400).json({ error: "Cannot publish an empty checklist." });
      return;
    }

    await db
      .update(magicLinkTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(magicLinkTokensTable.intakeSessionId, session.id),
          isNull(magicLinkTokensTable.revokedAt),
        ),
      );
    await revokePortalSessionsForIntake(session.id);

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
    await db.insert(magicLinkTokensTable).values({
      intakeSessionId: session.id,
      tokenHash,
      expiresAt,
    });
    await db
      .update(intakeSessionsTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(intakeSessionsTable.id, session.id));

    const magicLinkUrl = buildMagicLinkUrl(req, rawToken);
    res.json(
      PublishChecklistResponse.parse({
        magicLinkUrl,
        expiresAt: expiresAt.toISOString(),
      }),
    );
  },
);

router.post(
  "/admin/clients/:clientId/revoke",
  async (req, res): Promise<void> => {
    const params = RevokeChecklistLinkParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const session = await ensureCurrentSession(params.data.clientId);
    await db
      .update(magicLinkTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(magicLinkTokensTable.intakeSessionId, session.id),
          isNull(magicLinkTokensTable.revokedAt),
        ),
      );
    await revokePortalSessionsForIntake(session.id);
    await db
      .update(intakeSessionsTable)
      .set({ status: "draft" })
      .where(eq(intakeSessionsTable.id, session.id));
    res.sendStatus(204);
  },
);

router.post(
  "/admin/clients/:clientId/preview-session",
  async (req, res): Promise<void> => {
    const params = CreateAdminPreviewSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const auth = getAuth(req);
    const adminClerkUserId = auth?.userId;
    if (!adminClerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    // Ensure an intake session exists so we have something to preview against.
    const session = await ensureCurrentSession(client.id);
    const preview = await createAdminPreviewSession({
      intakeSessionId: session.id,
      adminClerkUserId,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    setPortalSessionCookie(res, preview.id, ADMIN_PREVIEW_TTL_MS);

    const proto =
      headerString(req.headers["x-forwarded-proto"]) ?? req.protocol ?? "https";
    const host =
      headerString(req.headers["x-forwarded-host"]) ??
      headerString(req.headers.host) ??
      "";
    const previewUrl = `${proto}://${host}/portal/checklist?adminPreview=1`;

    res.json(
      CreateAdminPreviewSessionResponse.parse({
        previewUrl,
        expiresAt: preview.expiresAt.toISOString(),
        clientName: client.name,
      }),
    );
  },
);

router.post(
  "/admin/clients/:clientId/send-link",
  async (req, res): Promise<void> => {
    const params = SendChecklistEmailParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const session = await ensureCurrentSession(client.id);

    if (session.status !== "published") {
      if (!client.driveFolderId) {
        res
          .status(400)
          .json({ error: "Add a Drive folder for this client before sending." });
        return;
      }
      const items = await db
        .select()
        .from(checklistItemsTable)
        .where(eq(checklistItemsTable.intakeSessionId, session.id));
      if (items.length === 0) {
        res.status(400).json({ error: "Publish the checklist first." });
        return;
      }
    }

    await db
      .update(magicLinkTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(magicLinkTokensTable.intakeSessionId, session.id),
          isNull(magicLinkTokensTable.revokedAt),
        ),
      );
    await revokePortalSessionsForIntake(session.id);
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
    await db.insert(magicLinkTokensTable).values({
      intakeSessionId: session.id,
      tokenHash,
      expiresAt,
    });
    if (session.status !== "published") {
      await db
        .update(intakeSessionsTable)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(intakeSessionsTable.id, session.id));
    }
    const magicLinkUrl = buildMagicLinkUrl(req, rawToken);
    const result = mockGmailSend({
      to: client.email,
      clientName: client.name,
      magicLinkUrl,
    });
    res.json(
      SendChecklistEmailResponse.parse({
        sent: result.sent,
        recipient: result.recipient,
        mode: result.mode,
        previewBody: result.previewBody,
      }),
    );
  },
);

export default router;
