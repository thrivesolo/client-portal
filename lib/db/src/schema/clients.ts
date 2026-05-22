import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  notionPageId: text("notion_page_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  driveFolderId: text("drive_folder_id"),
  priorReturnSummary: text("prior_return_summary"),
  tags: text("tags").array().notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Client = typeof clientsTable.$inferSelect;
export type InsertClient = typeof clientsTable.$inferInsert;
