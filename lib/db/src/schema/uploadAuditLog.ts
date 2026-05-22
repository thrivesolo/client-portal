import { pgTable, text, uuid, timestamp, integer } from "drizzle-orm/pg-core";
import { intakeSessionsTable } from "./intakeSessions";
import { checklistItemsTable } from "./checklistItems";

export const uploadAuditLogTable = pgTable("upload_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  intakeSessionId: uuid("intake_session_id")
    .notNull()
    .references(() => intakeSessionsTable.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => checklistItemsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  size: integer("size").notNull(),
  driveFileId: text("drive_file_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UploadAuditEntry = typeof uploadAuditLogTable.$inferSelect;
