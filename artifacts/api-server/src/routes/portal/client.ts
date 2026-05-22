import { Router, type IRouter } from "express";
import express from "express";
import Busboy from "busboy";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { eq, and, isNull, gt } from "drizzle-orm";
import {
  db,
  checklistItemsTable,
  magicLinkTokensTable,
  uploadAuditLogTable,
} from "@workspace/db";
import {
  GetClientSessionResponse,
  RedeemMagicLinkBody,
  RedeemMagicLinkResponse,
} from "@workspace/api-zod";
import {
  hashToken,
  setPortalSessionCookie,
  getPortalSessionCookie,
  clearPortalSessionCookie,
  createPortalSession,
  loadPortalSessionById,
  revokePortalSessionById,
  type ResolvedPortalSession,
} from "../../lib/portalSession";
import { mockDriveUpload } from "../../lib/mockServices";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const sessionReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const redeemLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const sid = getPortalSessionCookie(req);
    return sid ? `sid:${sid}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
});

async function buildClientView(active: ResolvedPortalSession) {
  const items = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.intakeSessionId, active.intakeSession.id))
    .orderBy(checklistItemsTable.position, checklistItemsTable.createdAt);

  const itemsTotal = items.length;
  const itemsCompleted = items.filter(
    (i) => i.status === "uploaded" || i.status === "reviewed",
  ).length;
  const clientName = active.client.name;
  return {
    clientFirstName: clientName.split(" ")[0] ?? clientName,
    clientFullName: clientName,
    filingYear: active.intakeSession.filingYear,
    itemsTotal,
    itemsCompleted,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      category: i.category,
      whyWeNeedThis: i.whyWeNeedThis,
      status: i.status,
      files: (i.files ?? []).map((f) => ({
        ...f,
        driveFileUrl: f.driveFileUrl ?? null,
      })),
    })),
    mode: active.isAdminPreview ? ("admin_preview" as const) : ("client" as const),
    adminDisplayName: active.adminDisplayName,
    sessionStatus: active.intakeSession.status,
  };
}

router.post(
  "/client/redeem",
  redeemLimiter,
  express.json(),
  async (req, res): Promise<void> => {
    const body = RedeemMagicLinkBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const tokenHash = hashToken(body.data.token);
    const [token] = await db
      .select()
      .from(magicLinkTokensTable)
      .where(
        and(
          eq(magicLinkTokensTable.tokenHash, tokenHash),
          isNull(magicLinkTokensTable.revokedAt),
          gt(magicLinkTokensTable.expiresAt, new Date()),
        ),
      );
    if (!token) {
      res.status(400).json({ error: "Invalid or expired link." });
      return;
    }
    await db
      .update(magicLinkTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(magicLinkTokensTable.id, token.id));

    const portalSession = await createPortalSession({
      intakeSessionId: token.intakeSessionId,
      magicLinkTokenId: token.id,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });

    const resolved = await loadPortalSessionById(portalSession.id);
    if (!resolved) {
      res.status(400).json({ error: "Session is not active." });
      return;
    }

    setPortalSessionCookie(res, portalSession.id);
    const view = await buildClientView(resolved);
    res.json(RedeemMagicLinkResponse.parse(view));
  },
);

router.get(
  "/client/session",
  sessionReadLimiter,
  async (req, res): Promise<void> => {
    const sessionId = getPortalSessionCookie(req);
    if (!sessionId) {
      res.status(401).json({ error: "No session." });
      return;
    }
    const active = await loadPortalSessionById(sessionId);
    if (!active) {
      clearPortalSessionCookie(res);
      res.status(401).json({ error: "Session expired." });
      return;
    }
    const view = await buildClientView(active);
    res.json(GetClientSessionResponse.parse(view));
  },
);

router.post(
  "/client/exit-preview",
  async (req, res): Promise<void> => {
    const sessionId = getPortalSessionCookie(req);
    if (!sessionId) {
      clearPortalSessionCookie(res);
      res.status(204).end();
      return;
    }
    const active = await loadPortalSessionById(sessionId);
    if (!active) {
      clearPortalSessionCookie(res);
      res.status(204).end();
      return;
    }
    if (!active.isAdminPreview) {
      // Don't tear down a real client session via this endpoint.
      res
        .status(401)
        .json({ error: "Not an admin preview session." });
      return;
    }
    await revokePortalSessionById(active.portalSession.id);
    clearPortalSessionCookie(res);
    res.status(204).end();
  },
);

router.post(
  "/client/items/:itemId/upload",
  uploadLimiter,
  (req, res, next) => {
    (async () => {
      const sessionId = getPortalSessionCookie(req);
      if (!sessionId) {
        res.status(401).json({ error: "No session." });
        return;
      }
      const active = await loadPortalSessionById(sessionId);
      if (!active) {
        res.status(401).json({ error: "Session expired." });
        return;
      }
      if (active.isAdminPreview) {
        res.status(403).json({
          error:
            "Read-only admin preview — uploads are disabled while previewing as a client.",
        });
        return;
      }
      const itemIdRaw = req.params.itemId;
      const itemId = Array.isArray(itemIdRaw) ? itemIdRaw[0] : itemIdRaw;
      if (!itemId) {
        res.status(400).json({ error: "Missing item id." });
        return;
      }
      const [item] = await db
        .select()
        .from(checklistItemsTable)
        .where(eq(checklistItemsTable.id, itemId));
      if (!item || item.intakeSessionId !== active.intakeSession.id) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      if (!active.client.driveFolderId) {
        res
          .status(400)
          .json({ error: "Client has no Drive folder configured." });
        return;
      }

      const busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
      });
      let aborted = false;
      let fileCaught = false;
      let totalBytes = 0;
      let uploadFilename = "upload.bin";
      let uploadMime = "application/octet-stream";
      let uploadError: string | null = null;

      busboy.on("file", (_field, file, info) => {
        fileCaught = true;
        uploadFilename = info.filename || uploadFilename;
        uploadMime = info.mimeType || uploadMime;
        file.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
        });
        file.on("limit", () => {
          aborted = true;
          uploadError = `File exceeds ${MAX_UPLOAD_BYTES} bytes.`;
          file.resume();
        });
      });
      busboy.on("error", (err: Error) => {
        if (!res.headersSent) {
          res.status(400).json({ error: err.message });
        }
      });
      busboy.on("close", async () => {
        try {
          if (!fileCaught) {
            res.status(400).json({ error: "No file uploaded." });
            return;
          }
          if (uploadError || aborted) {
            res
              .status(400)
              .json({ error: uploadError ?? "Upload aborted." });
            return;
          }
          const uploadResult = await mockDriveUpload({
            folderId: active.client.driveFolderId!,
            filename: uploadFilename,
            mimeType: uploadMime,
            size: totalBytes,
          });
          const newFile = {
            filename: uploadFilename,
            driveFileId: uploadResult.driveFileId,
            driveFileUrl: uploadResult.driveFileUrl,
            size: totalBytes,
            uploadedAt: new Date().toISOString(),
          };
          const updatedFiles = [...(item.files ?? []), newFile];
          await db
            .update(checklistItemsTable)
            .set({
              files: updatedFiles,
              status:
                item.status === "reviewed" ? "reviewed" : "uploaded",
            })
            .where(eq(checklistItemsTable.id, item.id));
          await db.insert(uploadAuditLogTable).values({
            intakeSessionId: active.intakeSession.id,
            itemId: item.id,
            filename: uploadFilename,
            size: totalBytes,
            driveFileId: uploadResult.driveFileId,
            ip: req.ip ?? null,
            userAgent: req.get("user-agent") ?? null,
          });
          const [refreshed] = await db
            .select()
            .from(checklistItemsTable)
            .where(eq(checklistItemsTable.id, item.id));
          res.json({
            id: refreshed.id,
            title: refreshed.title,
            description: refreshed.description,
            category: refreshed.category,
            whyWeNeedThis: refreshed.whyWeNeedThis,
            status: refreshed.status,
            files: (refreshed.files ?? []).map((f) => ({
              ...f,
              driveFileUrl: f.driveFileUrl ?? null,
            })),
          });
        } catch (e: unknown) {
          req.log.error({ err: e }, "Upload handler failed");
          if (!res.headersSent) {
            const message =
              e instanceof Error ? e.message : "Upload failed.";
            res.status(500).json({ error: message });
          }
        }
      });
      req.pipe(busboy);
    })().catch(next);
  },
);

router.delete(
  "/client/items/:itemId/files/:fileId",
  uploadLimiter,
  async (req, res): Promise<void> => {
    const sessionId = getPortalSessionCookie(req);
    if (!sessionId) {
      res.status(401).json({ error: "No session." });
      return;
    }
    const active = await loadPortalSessionById(sessionId);
    if (!active) {
      res.status(401).json({ error: "Session expired." });
      return;
    }
    if (active.isAdminPreview) {
      res.status(403).json({
        error:
          "Read-only admin preview — file deletes are disabled while previewing as a client.",
      });
      return;
    }
    const itemIdRaw = req.params.itemId;
    const itemId = Array.isArray(itemIdRaw) ? itemIdRaw[0] : itemIdRaw;
    const fileIdRaw = req.params.fileId;
    const fileId = Array.isArray(fileIdRaw) ? fileIdRaw[0] : fileIdRaw;
    if (!itemId || !fileId) {
      res.status(400).json({ error: "Missing id." });
      return;
    }
    const [item] = await db
      .select()
      .from(checklistItemsTable)
      .where(eq(checklistItemsTable.id, itemId));
    if (!item || item.intakeSessionId !== active.intakeSession.id) {
      res.status(404).json({ error: "Item not found." });
      return;
    }
    const remainingFiles = (item.files ?? []).filter(
      (f) => f.driveFileId !== fileId,
    );
    const newStatus =
      remainingFiles.length === 0 && item.status !== "reviewed"
        ? "needed"
        : item.status;
    const [updated] = await db
      .update(checklistItemsTable)
      .set({ files: remainingFiles, status: newStatus })
      .where(eq(checklistItemsTable.id, itemId))
      .returning();
    res.json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      category: updated.category,
      whyWeNeedThis: updated.whyWeNeedThis,
      status: updated.status,
      files: (updated.files ?? []).map((f) => ({
        ...f,
        driveFileUrl: f.driveFileUrl ?? null,
      })),
    });
  },
);

export default router;
