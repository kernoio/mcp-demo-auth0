import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { currentAccess } from "../auth/context.js";
import { permission } from "../auth/permissions.js";
import { assertPermission } from "../domain/access.js";
import { DomainError, isDomainError } from "../domain/errors.js";
import { currencies } from "../domain/money.js";
import type { Database } from "../db/client.js";
import {
  cashSnapshot,
  createExpense,
  createTransfer,
  findMember,
  getAccount,
  getInvoice,
  listAccounts,
  listCards,
  listExpenses,
  listInvoices,
  listTransactions,
  payInvoice,
  setCardLimit,
  setCardStatus,
  type MemberView,
} from "../db/store.js";

const instructions =
  "Northwharf is a business account for a small company: multi-currency balances in integer minor units, a ledger of credits, debits and internal transfers, team debit cards, expenses, and supplier invoices. Every tool needs the signed-in member's bearer token and the permission named in its description.";

const minorAmount = z.number().int().positive().describe("Amount in integer minor units, such as pence or cents");
const currency = z.enum(currencies);
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function createNorthwharfServer(db: Database): McpServer {
  const server = new McpServer({ name: "northwharf", version: "1.0.0" }, { instructions });

  server.registerTool(
    "whoami",
    {
      description: "Return the signed-in member, their organization, and the permissions on the token. Requires a valid bearer token for a known member.",
      annotations: readOnly,
    },
    async () =>
      perform(db, null, async (member) => ({
        member: {
          id: member.id,
          displayName: member.displayName,
          email: member.email,
          role: member.role,
        },
        organization: { id: member.organizationId, name: member.organizationName },
        subject: currentAccess().subject,
        permissions: currentAccess().permissions,
      })),
  );

  server.registerTool(
    "list_accounts",
    {
      description: "List the organization's currency accounts and balances. Requires accounts:read.",
      annotations: readOnly,
    },
    async () => perform(db, permission.accountsRead, (member) => listAccounts(db, member).then((rows) => ({ accounts: rows }))),
  );

  server.registerTool(
    "get_account",
    {
      description: "Fetch one account belonging to the caller's organization. Requires accounts:read.",
      inputSchema: { accountId: z.uuid() },
      annotations: readOnly,
    },
    async ({ accountId }) => perform(db, permission.accountsRead, (member) => getAccount(db, member, accountId)),
  );

  server.registerTool(
    "list_transactions",
    {
      description: "List recent ledger entries, optionally for one account. Requires accounts:read.",
      inputSchema: { accountId: z.uuid().optional() },
      annotations: readOnly,
    },
    async ({ accountId }) =>
      perform(db, permission.accountsRead, (member) =>
        listTransactions(db, member, accountId).then((rows) => ({ transactions: rows })),
      ),
  );

  server.registerTool(
    "create_transfer",
    {
      description:
        "Move money between two accounts of the same organization and currency. Rejects insufficient funds and a currency mismatch. Requires transfers:write.",
      inputSchema: {
        fromAccountId: z.uuid(),
        toAccountId: z.uuid(),
        amountMinor: minorAmount,
        description: z.string().trim().min(1).max(200).optional(),
      },
      annotations: mutation,
    },
    async ({ fromAccountId, toAccountId, amountMinor, description }) =>
      perform(db, permission.transfersWrite, (member) =>
        createTransfer(db, member, {
          fromAccountId,
          toAccountId,
          amountMinor,
          ...(description === undefined ? {} : { description }),
        }),
      ),
  );

  server.registerTool(
    "list_expenses",
    {
      description: "List expenses recorded for the organization. Requires expenses:read.",
      annotations: readOnly,
    },
    async () => perform(db, permission.expensesRead, (member) => listExpenses(db, member).then((rows) => ({ expenses: rows }))),
  );

  server.registerTool(
    "create_expense",
    {
      description: "Record an expense. Requires expenses:write.",
      inputSchema: {
        merchant: z.string().trim().min(1).max(120),
        amountMinor: minorAmount,
        currency,
        category: z.string().trim().min(1).max(40),
        status: z.enum(["draft", "submitted", "approved"]).default("submitted"),
      },
      annotations: mutation,
    },
    async ({ merchant, amountMinor, currency: expenseCurrency, category, status }) =>
      perform(db, permission.expensesWrite, (member) =>
        createExpense(db, member, { merchant, amountMinor, currency: expenseCurrency, category, status }),
      ),
  );

  server.registerTool(
    "list_invoices",
    {
      description: "List supplier invoices. Requires invoices:read.",
      annotations: readOnly,
    },
    async () => perform(db, permission.invoicesRead, (member) => listInvoices(db, member).then((rows) => ({ invoices: rows }))),
  );

  server.registerTool(
    "get_invoice",
    {
      description: "Fetch one supplier invoice. Requires invoices:read.",
      inputSchema: { invoiceId: z.uuid() },
      annotations: readOnly,
    },
    async ({ invoiceId }) => perform(db, permission.invoicesRead, (member) => getInvoice(db, member, invoiceId)),
  );

  server.registerTool(
    "pay_invoice",
    {
      description:
        "Pay an unpaid supplier invoice from an account in the same currency. Posts one ledger debit and marks the invoice paid. A second call for an invoice that is already paid does not post again. Requires invoices:pay.",
      inputSchema: { invoiceId: z.uuid(), accountId: z.uuid() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ invoiceId, accountId }) =>
      perform(db, permission.invoicesPay, (member) => payInvoice(db, member, { invoiceId, accountId })),
  );

  server.registerTool(
    "list_cards",
    {
      description: "List team debit cards, including status and spending limit. Requires cards:read.",
      annotations: readOnly,
    },
    async () => perform(db, permission.cardsRead, (member) => listCards(db, member).then((rows) => ({ cards: rows }))),
  );

  server.registerTool(
    "set_card_status",
    {
      description: "Set a card to active, frozen, or cancelled. Requires cards:manage.",
      inputSchema: { cardId: z.uuid(), status: z.enum(["active", "frozen", "cancelled"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ cardId, status }) =>
      perform(db, permission.cardsManage, (member) => setCardStatus(db, member, { cardId, status })),
  );

  server.registerTool(
    "set_card_limit",
    {
      description: "Set a card spending limit in integer minor units. Requires cards:manage.",
      inputSchema: { cardId: z.uuid(), spendingLimitMinor: minorAmount },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ cardId, spendingLimitMinor }) =>
      perform(db, permission.cardsManage, (member) => setCardLimit(db, member, { cardId, spendingLimitMinor })),
  );

  server.registerTool(
    "cash_snapshot",
    {
      description:
        "Balances by currency, recent outflows, burn over the last 30 days of ledger debits, and runway in months. Internal transfers are not burn. Requires treasury:read.",
      annotations: readOnly,
    },
    async () => perform(db, permission.treasuryRead, (member) => cashSnapshot(db, member)),
  );

  return server;
}

async function perform(
  db: Database,
  required: string | null,
  work: (member: MemberView) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const access = currentAccess();
    if (required) {
      assertPermission(access.permissions, required);
    }
    const member = await findMember(db, access.subject);
    const value = await work(member);
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const domain = isDomainError(error) ? error : new DomainError("unexpected", "Unexpected failure");
    if (!isDomainError(error)) {
      console.error(error);
    }
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: domain.code, message: domain.message }) }],
    };
  }
}
