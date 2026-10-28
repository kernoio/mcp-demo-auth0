import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Currency } from "../domain/money.js";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    authSubject: text("auth_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("members_auth_subject_key").on(table.authSubject),
    check("members_role", sql`${table.role} in ('owner', 'finance', 'cardholder')`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    currency: text("currency").$type<Currency>().notNull(),
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_org_name_key").on(table.organizationId, table.name),
    check("accounts_balance_non_negative", sql`${table.balanceMinor} >= 0`),
    check("accounts_currency", sql`${table.currency} in ('GBP', 'EUR', 'USD')`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").$type<Currency>().notNull(),
    description: text("description").notNull(),
    transferGroupId: uuid("transfer_group_id"),
    counterpartyAccountId: uuid("counterparty_account_id").references(() => accounts.id),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => members.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("transactions_account_occurred_idx").on(table.accountId, table.occurredAt),
    check("transactions_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "transactions_kind",
      sql`${table.kind} in ('credit', 'debit', 'transfer_in', 'transfer_out')`,
    ),
    check("transactions_currency", sql`${table.currency} in ('GBP', 'EUR', 'USD')`),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    lastFour: text("last_four").notNull(),
    status: text("status").notNull(),
    spendingLimitMinor: bigint("spending_limit_minor", { mode: "number" }).notNull(),
    currency: text("currency").$type<Currency>().notNull(),
  },
  (table) => [
    check("cards_status", sql`${table.status} in ('active', 'frozen', 'cancelled')`),
    check("cards_limit_positive", sql`${table.spendingLimitMinor} > 0`),
    check("cards_last_four", sql`${table.lastFour} ~ '^[0-9]{4}$'`),
    check("cards_currency", sql`${table.currency} in ('GBP', 'EUR', 'USD')`),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    merchant: text("merchant").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").$type<Currency>().notNull(),
    category: text("category").notNull(),
    status: text("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check("expenses_amount_positive", sql`${table.amountMinor} > 0`),
    check("expenses_status", sql`${table.status} in ('draft', 'submitted', 'approved')`),
    check("expenses_currency", sql`${table.currency} in ('GBP', 'EUR', 'USD')`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    counterparty: text("counterparty").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").$type<Currency>().notNull(),
    dueOn: text("due_on").notNull(),
    status: text("status").notNull(),
    paidFromAccountId: uuid("paid_from_account_id").references(() => accounts.id),
    paidTransactionId: uuid("paid_transaction_id").references(() => transactions.id),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check("invoices_amount_positive", sql`${table.amountMinor} > 0`),
    check("invoices_status", sql`${table.status} in ('unpaid', 'paid')`),
    check("invoices_due_on", sql`${table.dueOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check("invoices_currency", sql`${table.currency} in ('GBP', 'EUR', 'USD')`),
    check(
      "invoices_paid_fields",
      sql`(${table.status} = 'unpaid' and ${table.paidFromAccountId} is null and ${table.paidTransactionId} is null and ${table.paidAt} is null) or (${table.status} = 'paid' and ${table.paidFromAccountId} is not null and ${table.paidTransactionId} is not null and ${table.paidAt} is not null)`,
    ),
  ],
);
