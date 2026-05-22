import { pgTable, text, uuid, timestamp, boolean } from "drizzle-orm/pg-core";
import { intakeSessionsTable } from "./intakeSessions";
import { magicLinkTokensTable } from "./magicLinkTokens";

export const portalSessionsTable = pgTable("portal_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  intakeSessionId: uuid("intake_session_id")
    .notNull()
    .references(() => intakeSessionsTable.id, { onDelete: "cascade" }),
  magicLinkTokenId: uuid("magic_link_token_id").references(
    () => magicLinkTokensTable.id,
    { onDelete: "cascade" },
  ),
  isAdminPreview: boolean("is_admin_preview").notNull().default(false),
  adminClerkUserId: text("admin_clerk_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PortalSession = typeof portalSessionsTable.$inferSelect;
export type InsertPortalSession = typeof portalSessionsTable.$inferInsert;
