import { pgTable, text, uuid, timestamp, integer } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const intakeSessionsTable = pgTable("intake_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  filingYear: integer("filing_year").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] })
    .notNull()
    .default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type IntakeSession = typeof intakeSessionsTable.$inferSelect;
export type InsertIntakeSession = typeof intakeSessionsTable.$inferInsert;
