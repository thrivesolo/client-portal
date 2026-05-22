import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { intakeSessionsTable } from "./intakeSessions";

export const magicLinkTokensTable = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  intakeSessionId: uuid("intake_session_id")
    .notNull()
    .references(() => intakeSessionsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MagicLinkToken = typeof magicLinkTokensTable.$inferSelect;
export type InsertMagicLinkToken = typeof magicLinkTokensTable.$inferInsert;
