import crypto from "crypto";
import type { Request, Response } from "express";
import { eq, and, isNull, gt } from "drizzle-orm";
import {
  db,
  portalSessionsTable,
  intakeSessionsTable,
  clientsTable,
  magicLinkTokensTable,
  adminUsersTable,
  type PortalSession,
} from "@workspace/db";

export const PORTAL_COOKIE_NAME = "portal_session";
export const PORTAL_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const ADMIN_PREVIEW_TTL_MS = 1000 * 60 * 30;

export function cookieSecret(): string {
  const secret = process.env.PORTAL_COOKIE_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PORTAL_COOKIE_SECRET must be set (>=16 chars) in production.",
    );
  }
  return "dev-only-portal-cookie-secret-change-me";
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createPortalSession(input: {
  intakeSessionId: string;
  magicLinkTokenId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<PortalSession> {
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_MS);
  const [created] = await db
    .insert(portalSessionsTable)
    .values({
      intakeSessionId: input.intakeSessionId,
      magicLinkTokenId: input.magicLinkTokenId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning();
  return created;
}

export async function createAdminPreviewSession(input: {
  intakeSessionId: string;
  adminClerkUserId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<PortalSession> {
  const expiresAt = new Date(Date.now() + ADMIN_PREVIEW_TTL_MS);
  const [created] = await db
    .insert(portalSessionsTable)
    .values({
      intakeSessionId: input.intakeSessionId,
      magicLinkTokenId: null,
      isAdminPreview: true,
      adminClerkUserId: input.adminClerkUserId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning();
  return created;
}

export function setPortalSessionCookie(
  res: Response,
  sessionId: string,
  maxAgeMs: number = PORTAL_SESSION_TTL_MS,
): void {
  res.cookie(PORTAL_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeMs,
    path: "/",
    signed: true,
  });
}

export function getPortalSessionCookie(req: Request): string | null {
  const raw = req.signedCookies?.[PORTAL_COOKIE_NAME];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function clearPortalSessionCookie(res: Response): void {
  res.clearCookie(PORTAL_COOKIE_NAME, { path: "/" });
}

export type ResolvedPortalSession = {
  portalSession: PortalSession;
  intakeSession: typeof intakeSessionsTable.$inferSelect;
  client: typeof clientsTable.$inferSelect;
  isAdminPreview: boolean;
  adminDisplayName: string | null;
};

export async function loadPortalSessionById(
  sessionId: string,
): Promise<ResolvedPortalSession | null> {
  const [portalSession] = await db
    .select()
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.id, sessionId),
        isNull(portalSessionsTable.revokedAt),
        gt(portalSessionsTable.expiresAt, new Date()),
      ),
    );
  if (!portalSession) return null;

  if (!portalSession.isAdminPreview) {
    if (!portalSession.magicLinkTokenId) return null;
    const [magicLinkToken] = await db
      .select()
      .from(magicLinkTokensTable)
      .where(eq(magicLinkTokensTable.id, portalSession.magicLinkTokenId));
    if (!magicLinkToken || magicLinkToken.revokedAt) return null;
  }

  const [intakeSession] = await db
    .select()
    .from(intakeSessionsTable)
    .where(eq(intakeSessionsTable.id, portalSession.intakeSessionId));
  if (!intakeSession) return null;
  // Real client sessions require a published intake; admin previews work
  // against any intake (no_session has already been turned into a draft by
  // the preview endpoint).
  if (!portalSession.isAdminPreview && intakeSession.status !== "published") {
    return null;
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, intakeSession.clientId));
  if (!client) return null;

  await db
    .update(portalSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(portalSessionsTable.id, portalSession.id));

  let adminDisplayName: string | null = null;
  if (portalSession.isAdminPreview && portalSession.adminClerkUserId) {
    const [admin] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.clerkUserId, portalSession.adminClerkUserId));
    adminDisplayName = admin?.name ?? admin?.email ?? null;
  }

  return {
    portalSession,
    intakeSession,
    client,
    isAdminPreview: portalSession.isAdminPreview,
    adminDisplayName,
  };
}

export async function revokePortalSessionsForIntake(
  intakeSessionId: string,
): Promise<void> {
  // Only revoke real client sessions when a magic link is rotated/revoked —
  // active admin previews must be unaffected so admins can keep inspecting
  // the new published state.
  await db
    .update(portalSessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(portalSessionsTable.intakeSessionId, intakeSessionId),
        isNull(portalSessionsTable.revokedAt),
        eq(portalSessionsTable.isAdminPreview, false),
      ),
    );
}

export async function revokePortalSessionById(
  sessionId: string,
): Promise<void> {
  await db
    .update(portalSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(portalSessionsTable.id, sessionId));
}
