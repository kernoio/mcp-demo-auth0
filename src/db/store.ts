import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DomainError } from "../domain/errors.js";
import {
  planInvoicePayment,
  planTransfer,
  type AccountPosition,
  type InvoicePosition,
} from "../domain/ledger.js";
import { isCurrency, runwayMonths, type Currency } from "../domain/money.js";
import type { Database, DatabaseTransaction } from "./client.js";
import { accounts, cards, expenses, invoices, members, organizations, transactions } from "./schema.js";

const burnWindowDays = 30;
const recentOutflowLimit = 8;

export type MemberView = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  displayName: string;
  role: "owner" | "finance" | "cardholder";
};

export type AccountView = {
  id: string;
  name: string;
  currency: Currency;
  balanceMinor: number;
};

export type TransactionView = {
  id: string;
  accountId: string;
  kind: string;
  amountMinor: number;
  currency: Currency;
  description: string;
  transferGroupId: string | null;
  counterpartyAccountId: string | null;
  occurredAt: string;
};

export type ExpenseView = {
  id: string;
  memberId: string;
  merchant: string;
  amountMinor: number;
  currency: Currency;
  category: string;
  status: string;
  occurredAt: string;
};

export type InvoiceView = {
  id: string;
  counterparty: string;
  amountMinor: number;
  currency: Currency;
  dueOn: string;
  status: string;
  paidFromAccountId: string | null;
  paidTransactionId: string | null;
  paidAt: string | null;
};

export type CardView = {
  id: string;
  memberId: string;
  accountId: string;
  lastFour: string;
  status: string;
  spendingLimitMinor: number;
  currency: Currency;
};

const roles = ["owner", "finance", "cardholder"] as const;

export async function memberExists(db: Database, subject: string): Promise<boolean> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.authSubject, subject))
    .limit(1);
  return rows.length > 0;
}

export async function provisionOwnerMember(
  db: Database,
  input: { subject: string; email: string; displayName: string },
): Promise<void> {
  const rows = await db.select({ id: organizations.id }).from(organizations);
  const organization = rows.length === 1 ? rows[0] : undefined;
  if (!organization) {
    throw new DomainError(
      "invalid_state",
      rows.length === 0 ? "Northwharf has no organization yet" : "Northwharf has more than one organization",
    );
  }
  await db.insert(members).values({
    id: randomUUID(),
    organizationId: organization.id,
    authSubject: input.subject,
    email: input.email,
    displayName: input.displayName,
    role: "owner",
  });
}

export async function findMember(db: Database, subject: string): Promise<MemberView> {
  const rows = await db
    .select({
      id: members.id,
      organizationId: members.organizationId,
      organizationName: organizations.name,
      email: members.email,
      displayName: members.displayName,
      role: members.role,
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(eq(members.authSubject, subject))
    .limit(1);
  const row = rows[0];
  if (!row || !isRole(row.role)) {
    throw new DomainError("not_found", "No Northwharf member matches this token subject");
  }
  return { ...row, role: row.role };
}

export async function listAccounts(db: Database, member: MemberView): Promise<AccountView[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.organizationId, member.organizationId))
    .orderBy(asc(accounts.name));
  return rows.map(toAccount);
}

export async function getAccount(db: Database, member: MemberView, accountId: string): Promise<AccountView> {
  const row = await loadAccount(db, member.organizationId, accountId);
  return toAccount(row);
}

export async function listTransactions(
  db: Database,
  member: MemberView,
  accountId: string | undefined,
): Promise<TransactionView[]> {
  const filters = [eq(transactions.organizationId, member.organizationId)];
  if (accountId) {
    await loadAccount(db, member.organizationId, accountId);
    filters.push(eq(transactions.accountId, accountId));
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.occurredAt))
    .limit(50);
  return rows.map(toTransaction);
}

export async function createTransfer(
  db: Database,
  member: MemberView,
  input: { fromAccountId: string; toAccountId: string; amountMinor: number; description?: string },
): Promise<{
  transferGroupId: string;
  currency: Currency;
  amountMinor: number;
  from: AccountView;
  to: AccountView;
}> {
  return db.transaction(async (tx) => {
    const locked = await lockAccounts(tx, [input.fromAccountId, input.toAccountId]);
    const fromRow = locked.get(input.fromAccountId);
    const toRow = locked.get(input.toAccountId);
    if (!fromRow || !toRow) {
      throw new DomainError("not_found", "One or both accounts were not found");
    }
    const from = position(fromRow);
    const to = position(toRow);
    planTransfer({
      from,
      to,
      amountMinor: input.amountMinor,
      actorOrganizationId: member.organizationId,
    });
    const debited = await tx
      .update(accounts)
      .set({ balanceMinor: sql`${accounts.balanceMinor} - ${input.amountMinor}` })
      .where(and(eq(accounts.id, from.id), gte(accounts.balanceMinor, input.amountMinor)))
      .returning();
    const debitedRow = debited[0];
    if (!debitedRow) {
      throw new DomainError("insufficient_funds", "The source account does not have enough funds");
    }
    const credited = await tx
      .update(accounts)
      .set({ balanceMinor: sql`${accounts.balanceMinor} + ${input.amountMinor}` })
      .where(eq(accounts.id, to.id))
      .returning();
    const creditedRow = credited[0];
    if (!creditedRow) {
      throw new DomainError("not_found", "The destination account was not found");
    }
    const transferGroupId = randomUUID();
    const description = input.description?.trim() || "Internal transfer";
    const occurredAt = new Date();
    await tx.insert(transactions).values([
      {
        id: randomUUID(),
        organizationId: member.organizationId,
        accountId: from.id,
        kind: "transfer_out",
        amountMinor: input.amountMinor,
        currency: from.currency,
        description,
        transferGroupId,
        counterpartyAccountId: to.id,
        createdByMemberId: member.id,
        occurredAt,
      },
      {
        id: randomUUID(),
        organizationId: member.organizationId,
        accountId: to.id,
        kind: "transfer_in",
        amountMinor: input.amountMinor,
        currency: to.currency,
        description,
        transferGroupId,
        counterpartyAccountId: from.id,
        createdByMemberId: member.id,
        occurredAt,
      },
    ]);
    return {
      transferGroupId,
      currency: from.currency,
      amountMinor: input.amountMinor,
      from: toAccount(debitedRow),
      to: toAccount(creditedRow),
    };
  });
}

export async function listExpenses(db: Database, member: MemberView): Promise<ExpenseView[]> {
  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.organizationId, member.organizationId))
    .orderBy(desc(expenses.occurredAt));
  return rows.map(toExpense);
}

export async function createExpense(
  db: Database,
  member: MemberView,
  input: {
    merchant: string;
    amountMinor: number;
    currency: Currency;
    category: string;
    status: "draft" | "submitted" | "approved";
  },
): Promise<ExpenseView> {
  const rows = await db
    .insert(expenses)
    .values({
      id: randomUUID(),
      organizationId: member.organizationId,
      memberId: member.id,
      merchant: input.merchant.trim(),
      amountMinor: input.amountMinor,
      currency: input.currency,
      category: input.category.trim(),
      status: input.status,
      occurredAt: new Date(),
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new DomainError("unexpected", "Expense was not stored");
  }
  return toExpense(row);
}

export async function listInvoices(db: Database, member: MemberView): Promise<InvoiceView[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.organizationId, member.organizationId))
    .orderBy(asc(invoices.dueOn));
  return rows.map(toInvoice);
}

export async function getInvoice(db: Database, member: MemberView, invoiceId: string): Promise<InvoiceView> {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, member.organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new DomainError("not_found", "Invoice was not found");
  }
  return toInvoice(row);
}

export async function payInvoice(
  db: Database,
  member: MemberView,
  input: { invoiceId: string; accountId: string },
): Promise<{ invoice: InvoiceView; alreadyPaid: boolean; transactionId: string | null }> {
  return db.transaction(async (tx) => {
    const invoiceRows = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
    const accountRows = await tx.select().from(accounts).where(eq(accounts.id, input.accountId)).for("update");
    const invoiceRow = invoiceRows[0];
    const accountRow = accountRows[0];
    if (!invoiceRow) {
      throw new DomainError("not_found", "Invoice was not found");
    }
    if (!accountRow) {
      throw new DomainError("not_found", "Account was not found");
    }
    const plan = planInvoicePayment({
      invoice: invoicePosition(invoiceRow),
      account: position(accountRow),
      actorOrganizationId: member.organizationId,
    });
    if (plan.outcome === "already_paid") {
      return { invoice: toInvoice(invoiceRow), alreadyPaid: true, transactionId: invoiceRow.paidTransactionId };
    }
    const debited = await tx
      .update(accounts)
      .set({ balanceMinor: sql`${accounts.balanceMinor} - ${invoiceRow.amountMinor}` })
      .where(and(eq(accounts.id, accountRow.id), gte(accounts.balanceMinor, invoiceRow.amountMinor)))
      .returning();
    if (!debited[0]) {
      throw new DomainError("insufficient_funds", "The account does not have enough funds to pay this invoice");
    }
    const transactionId = randomUUID();
    const paidAt = new Date();
    await tx.insert(transactions).values({
      id: transactionId,
      organizationId: member.organizationId,
      accountId: accountRow.id,
      kind: "debit",
      amountMinor: invoiceRow.amountMinor,
      currency: asCurrency(invoiceRow.currency),
      description: `Supplier payment — ${invoiceRow.counterparty}`,
      transferGroupId: null,
      counterpartyAccountId: null,
      createdByMemberId: member.id,
      occurredAt: paidAt,
    });
    const paid = await tx
      .update(invoices)
      .set({
        status: "paid",
        paidFromAccountId: accountRow.id,
        paidTransactionId: transactionId,
        paidAt,
      })
      .where(and(eq(invoices.id, invoiceRow.id), eq(invoices.status, "unpaid")))
      .returning();
    const paidRow = paid[0];
    if (!paidRow) {
      throw new DomainError("invalid_state", "Invoice could not be marked paid");
    }
    return { invoice: toInvoice(paidRow), alreadyPaid: false, transactionId };
  });
}

export async function listCards(db: Database, member: MemberView): Promise<CardView[]> {
  const rows = await db
    .select()
    .from(cards)
    .where(eq(cards.organizationId, member.organizationId))
    .orderBy(asc(cards.lastFour));
  return rows.map(toCard);
}

export async function setCardStatus(
  db: Database,
  member: MemberView,
  input: { cardId: string; status: "active" | "frozen" | "cancelled" },
): Promise<CardView> {
  const rows = await db
    .update(cards)
    .set({ status: input.status })
    .where(and(eq(cards.id, input.cardId), eq(cards.organizationId, member.organizationId)))
    .returning();
  const row = rows[0];
  if (!row) {
    throw new DomainError("not_found", "Card was not found");
  }
  return toCard(row);
}

export async function setCardLimit(
  db: Database,
  member: MemberView,
  input: { cardId: string; spendingLimitMinor: number },
): Promise<CardView> {
  const rows = await db
    .update(cards)
    .set({ spendingLimitMinor: input.spendingLimitMinor })
    .where(and(eq(cards.id, input.cardId), eq(cards.organizationId, member.organizationId)))
    .returning();
  const row = rows[0];
  if (!row) {
    throw new DomainError("not_found", "Card was not found");
  }
  return toCard(row);
}

export async function cashSnapshot(db: Database, member: MemberView): Promise<{
  asOf: string;
  burnWindowDays: number;
  currencies: Array<{ currency: Currency; balanceMinor: number; burnMinor: number; runwayMonths: number | null }>;
  recentOutflows: TransactionView[];
}> {
  const asOf = new Date();
  const since = new Date(asOf.getTime() - burnWindowDays * 24 * 60 * 60 * 1000);
  const accountRows = await db.select().from(accounts).where(eq(accounts.organizationId, member.organizationId));
  const burnRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, member.organizationId),
        eq(transactions.kind, "debit"),
        gte(transactions.occurredAt, since),
      ),
    );
  const recentRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, member.organizationId),
        inArray(transactions.kind, ["debit", "transfer_out"]),
      ),
    )
    .orderBy(desc(transactions.occurredAt))
    .limit(recentOutflowLimit);

  const balances = new Map<Currency, number>();
  for (const row of accountRows) {
    const currency = asCurrency(row.currency);
    balances.set(currency, (balances.get(currency) ?? 0) + row.balanceMinor);
  }
  const burn = new Map<Currency, number>();
  for (const row of burnRows) {
    const currency = asCurrency(row.currency);
    burn.set(currency, (burn.get(currency) ?? 0) + row.amountMinor);
  }
  const currencies = [...balances.keys()].sort();
  return {
    asOf: asOf.toISOString(),
    burnWindowDays,
    currencies: currencies.map((currency) => {
      const balanceMinor = balances.get(currency) ?? 0;
      const burnMinor = burn.get(currency) ?? 0;
      return { currency, balanceMinor, burnMinor, runwayMonths: runwayMonths(balanceMinor, burnMinor) };
    }),
    recentOutflows: recentRows.map(toTransaction),
  };
}

async function loadAccount(db: Database, organizationId: string, accountId: string) {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new DomainError("not_found", "Account was not found");
  }
  return row;
}

async function lockAccounts(tx: DatabaseTransaction, accountIds: string[]) {
  const rows = await tx
    .select()
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .orderBy(asc(accounts.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, row]));
}

function position(row: typeof accounts.$inferSelect): AccountPosition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    currency: asCurrency(row.currency),
    balanceMinor: row.balanceMinor,
  };
}

function invoicePosition(row: typeof invoices.$inferSelect): InvoicePosition {
  if (row.status !== "unpaid" && row.status !== "paid") {
    throw new DomainError("invalid_state", "Invoice status is not recognized");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    currency: asCurrency(row.currency),
    amountMinor: row.amountMinor,
    status: row.status,
  };
}

function toAccount(row: typeof accounts.$inferSelect): AccountView {
  return {
    id: row.id,
    name: row.name,
    currency: asCurrency(row.currency),
    balanceMinor: row.balanceMinor,
  };
}

function toTransaction(row: typeof transactions.$inferSelect): TransactionView {
  return {
    id: row.id,
    accountId: row.accountId,
    kind: row.kind,
    amountMinor: row.amountMinor,
    currency: asCurrency(row.currency),
    description: row.description,
    transferGroupId: row.transferGroupId,
    counterpartyAccountId: row.counterpartyAccountId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

function toExpense(row: typeof expenses.$inferSelect): ExpenseView {
  return {
    id: row.id,
    memberId: row.memberId,
    merchant: row.merchant,
    amountMinor: row.amountMinor,
    currency: asCurrency(row.currency),
    category: row.category,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
  };
}

function toInvoice(row: typeof invoices.$inferSelect): InvoiceView {
  return {
    id: row.id,
    counterparty: row.counterparty,
    amountMinor: row.amountMinor,
    currency: asCurrency(row.currency),
    dueOn: row.dueOn,
    status: row.status,
    paidFromAccountId: row.paidFromAccountId,
    paidTransactionId: row.paidTransactionId,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
  };
}

function toCard(row: typeof cards.$inferSelect): CardView {
  return {
    id: row.id,
    memberId: row.memberId,
    accountId: row.accountId,
    lastFour: row.lastFour,
    status: row.status,
    spendingLimitMinor: row.spendingLimitMinor,
    currency: asCurrency(row.currency),
  };
}

function asCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new DomainError("invalid_state", "Stored currency is not supported");
  }
  return value;
}

function isRole(value: string): value is MemberView["role"] {
  return (roles as readonly string[]).includes(value);
}
