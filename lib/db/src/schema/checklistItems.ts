import { pgTable, text, uuid, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { intakeSessionsTable } from "./intakeSessions";

export type UploadedFile = {
  filename: string;
  driveFileId: string;
  driveFileUrl: string | null;
  size: number;
  uploadedAt: string;
};

export const checklistItemsTable = pgTable("checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  intakeSessionId: uuid("intake_session_id")
    .notNull()
    .references(() => intakeSessionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  whyWeNeedThis: text("why_we_need_this").notNull(),
  position: integer("position").notNull().default(0),
  status: text("status", { enum: ["needed", "uploaded", "reviewed"] })
    .notNull()
    .default("needed"),
  files: jsonb("files").$type<UploadedFile[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ChecklistItem = typeof checklistItemsTable.$inferSelect;
export type InsertChecklistItem = typeof checklistItemsTable.$inferInsert;
