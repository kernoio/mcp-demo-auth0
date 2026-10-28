import { eq } from "drizzle-orm";
import { ownerSubject } from "../auth/permissions.js";
import type { Currency } from "../domain/money.js";
import type { Database } from "./client.js";
import { accounts, cards, expenses, invoices, members, organizations, transactions } from "./schema.js";

const ids = {
  org: "10000000-0000-4000-8000-000000000001",
  ada: "10000000-0000-4000-8000-000000000011",
  ben: "10000000-0000-4000-8000-000000000012",
  priya: "10000000-0000-4000-8000-000000000013",
  gbp: "10000000-0000-4000-8000-000000000021",
  gbpTax: "10000000-0000-4000-8000-000000000022",
  eur: "10000000-0000-4000-8000-000000000023",
  usd: "10000000-0000-4000-8000-000000000024",
  txHarbour: "10000000-0000-4000-8000-000000000031",
  txCedarReceipt: "10000000-0000-4000-8000-000000000032",
  txRent: "10000000-0000-4000-8000-000000000033",
  txPayroll: "10000000-0000-4000-8000-000000000034",
  txTaxOut: "10000000-0000-4000-8000-000000000035",
  txTaxIn: "10000000-0000-4000-8000-000000000036",
  txCedarPayment: "10000000-0000-4000-8000-000000000037",
  txField: "10000000-0000-4000-8000-000000000038",
  txHosting: "10000000-0000-4000-8000-000000000039",
  txRail: "10000000-0000-4000-8000-00000000003a",
  txPrint: "10000000-0000-4000-8000-00000000003b",
  txSoftware: "10000000-0000-4000-8000-00000000003c",
  cardAda: "10000000-0000-4000-8000-000000000041",
  cardBen: "10000000-0000-4000-8000-000000000042",
  cardPriya: "10000000-0000-4000-8000-000000000043",
  expenseRail: "10000000-0000-4000-8000-000000000051",
  expenseKitchen: "10000000-0000-4000-8000-000000000052",
  expensePaper: "10000000-0000-4000-8000-000000000053",
  invoicePrint: "10000000-0000-4000-8000-000000000061",
  invoiceHosting: "10000000-0000-4000-8000-000000000062",
  invoiceCedar: "10000000-0000-4000-8000-000000000063",
  transferTax: "10000000-0000-4000-8000-000000000071",
} as const;

const gbpHarbour = 20_000_000;
const gbpCedarReceipt = 4_500_000;
const gbpRent = 1_250_000;
const gbpPayroll = 6_400_000;
const gbpTaxMove = 750_000;
const gbpCedarPayment = 89_000;
const gbpOperatingBalance = gbpHarbour + gbpCedarReceipt - gbpRent - gbpPayroll - gbpTaxMove - gbpCedarPayment;

const eurField = 8_200_000;
const eurHosting = 640_000;
const eurRail = 180_000;
const eurOperatingBalance = eurField - eurHosting - eurRail;

const usdPrint = 5_000_000;
const usdSoftware = 225_000;
const usdOperatingBalance = usdPrint - usdSoftware;

export async function seedDatabase(db: Database, subject: string = ownerSubject): Promise<void> {
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, ids.org))
    .limit(1);
  if (existing.length > 0) {
    return;
  }

  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);
  const day = (offset: number) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: ids.org, name: "Northwharf Ltd" });
    await tx.insert(members).values([
      {
        id: ids.ada,
        organizationId: ids.org,
        authSubject: subject,
        email: "ada.north@northwharf.example",
        displayName: "Ada North",
        role: "owner",
      },
      {
        id: ids.ben,
        organizationId: ids.org,
        authSubject: "auth0|ben.calder",
        email: "ben.calder@northwharf.example",
        displayName: "Ben Calder",
        role: "finance",
      },
      {
        id: ids.priya,
        organizationId: ids.org,
        authSubject: "auth0|priya.holm",
        email: "priya.holm@northwharf.example",
        displayName: "Priya Holm",
        role: "cardholder",
      },
    ]);
    await tx.insert(accounts).values([
      account(ids.gbp, "Operating GBP", "GBP", gbpOperatingBalance),
      account(ids.gbpTax, "Tax reserve GBP", "GBP", gbpTaxMove),
      account(ids.eur, "Operating EUR", "EUR", eurOperatingBalance),
      account(ids.usd, "Operating USD", "USD", usdOperatingBalance),
    ]);
    await tx.insert(transactions).values([
      movement(ids.txHarbour, ids.gbp, "credit", gbpHarbour, "GBP", "Customer receipt — Harbour Goods", ids.ada, ago(18)),
      movement(ids.txCedarReceipt, ids.gbp, "credit", gbpCedarReceipt, "GBP", "Customer receipt — Cedar & Co", ids.ada, ago(12)),
      movement(ids.txRent, ids.gbp, "debit", gbpRent, "GBP", "Office rent", ids.ben, ago(8)),
      movement(ids.txPayroll, ids.gbp, "debit", gbpPayroll, "GBP", "Monthly payroll", ids.ben, ago(5)),
      movement(ids.txTaxOut, ids.gbp, "transfer_out", gbpTaxMove, "GBP", "Move to tax reserve", ids.ada, ago(3), ids.transferTax, ids.gbpTax),
      movement(ids.txTaxIn, ids.gbpTax, "transfer_in", gbpTaxMove, "GBP", "Move to tax reserve", ids.ada, ago(3), ids.transferTax, ids.gbp),
      movement(ids.txCedarPayment, ids.gbp, "debit", gbpCedarPayment, "GBP", "Supplier payment — Cedar Supplies", ids.ben, ago(9)),
      movement(ids.txField, ids.eur, "credit", eurField, "EUR", "Customer receipt — Field Kitchen", ids.ada, ago(15)),
      movement(ids.txHosting, ids.eur, "debit", eurHosting, "EUR", "Oak Lane Hosting", ids.ben, ago(6)),
      movement(ids.txRail, ids.eur, "debit", eurRail, "EUR", "Night Rail tickets", ids.priya, ago(2)),
      movement(ids.txPrint, ids.usd, "credit", usdPrint, "USD", "Customer receipt — Low Street Print", ids.ada, ago(16)),
      movement(ids.txSoftware, ids.usd, "debit", usdSoftware, "USD", "Software subscription", ids.ben, ago(4)),
    ]);
    await tx.insert(cards).values([
      card(ids.cardAda, ids.ada, ids.gbp, "4412", "active", 500_000, "GBP"),
      card(ids.cardBen, ids.ben, ids.gbp, "2281", "frozen", 200_000, "GBP"),
      card(ids.cardPriya, ids.priya, ids.eur, "9033", "active", 150_000, "EUR"),
    ]);
    await tx.insert(expenses).values([
      expense(ids.expenseRail, ids.priya, "Night Rail", 8_600, "EUR", "travel", "submitted", ago(2)),
      expense(ids.expenseKitchen, ids.ben, "Field Kitchen", 4_200, "GBP", "meals", "approved", ago(4)),
      expense(ids.expensePaper, ids.ada, "Harbour Paper", 12_800, "GBP", "supplies", "draft", ago(1)),
    ]);
    await tx.insert(invoices).values([
      {
        id: ids.invoicePrint,
        organizationId: ids.org,
        counterparty: "Low Street Print",
        amountMinor: 240_000,
        currency: "GBP" as const,
        dueOn: day(14),
        status: "unpaid",
      },
      {
        id: ids.invoiceHosting,
        organizationId: ids.org,
        counterparty: "Oak Lane Hosting",
        amountMinor: 64_000,
        currency: "EUR" as const,
        dueOn: day(7),
        status: "unpaid",
      },
      {
        id: ids.invoiceCedar,
        organizationId: ids.org,
        counterparty: "Cedar Supplies",
        amountMinor: gbpCedarPayment,
        currency: "GBP" as const,
        dueOn: day(-10),
        status: "paid",
        paidFromAccountId: ids.gbp,
        paidTransactionId: ids.txCedarPayment,
        paidAt: ago(9),
      },
    ]);
  });
}

function account(id: string, name: string, currency: Currency, balanceMinor: number) {
  return { id, organizationId: ids.org, name, currency, balanceMinor };
}

function movement(
  id: string,
  accountId: string,
  kind: "credit" | "debit" | "transfer_in" | "transfer_out",
  amountMinor: number,
  currency: Currency,
  description: string,
  createdByMemberId: string,
  occurredAt: Date,
  transferGroupId?: string,
  counterpartyAccountId?: string,
) {
  return {
    id,
    organizationId: ids.org,
    accountId,
    kind,
    amountMinor,
    currency,
    description,
    transferGroupId: transferGroupId ?? null,
    counterpartyAccountId: counterpartyAccountId ?? null,
    createdByMemberId,
    occurredAt,
  };
}

function card(
  id: string,
  memberId: string,
  accountId: string,
  lastFour: string,
  status: "active" | "frozen" | "cancelled",
  spendingLimitMinor: number,
  currency: Currency,
) {
  return { id, organizationId: ids.org, memberId, accountId, lastFour, status, spendingLimitMinor, currency };
}

function expense(
  id: string,
  memberId: string,
  merchant: string,
  amountMinor: number,
  currency: Currency,
  category: string,
  status: "draft" | "submitted" | "approved",
  occurredAt: Date,
) {
  return { id, organizationId: ids.org, memberId, merchant, amountMinor, currency, category, status, occurredAt };
}
