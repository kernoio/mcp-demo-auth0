import { DomainError } from "./errors.js";
import { type Currency, assertPositiveMinor } from "./money.js";

export type AccountPosition = {
  id: string;
  organizationId: string;
  currency: Currency;
  balanceMinor: number;
};

export type TransferPlan = {
  fromBalanceMinor: number;
  toBalanceMinor: number;
};

export function planTransfer(input: {
  from: AccountPosition;
  to: AccountPosition;
  amountMinor: number;
  actorOrganizationId: string;
}): TransferPlan {
  assertLedgerAmount(input.amountMinor);
  if (input.from.id === input.to.id) {
    throw new DomainError("same_account", "Choose two different accounts");
  }
  if (
    input.from.organizationId !== input.actorOrganizationId ||
    input.to.organizationId !== input.actorOrganizationId
  ) {
    throw new DomainError("wrong_organization", "Both accounts must belong to your organization");
  }
  if (input.from.currency !== input.to.currency) {
    throw new DomainError("currency_mismatch", "Transfers stay inside one currency");
  }
  if (input.from.balanceMinor < input.amountMinor) {
    throw new DomainError("insufficient_funds", "The source account does not have enough funds");
  }
  return {
    fromBalanceMinor: input.from.balanceMinor - input.amountMinor,
    toBalanceMinor: input.to.balanceMinor + input.amountMinor,
  };
}

export type InvoicePosition = {
  id: string;
  organizationId: string;
  currency: Currency;
  amountMinor: number;
  status: "unpaid" | "paid";
};

export type InvoicePaymentPlan = { outcome: "already_paid" } | { outcome: "pay"; nextBalanceMinor: number };

export function planInvoicePayment(input: {
  invoice: InvoicePosition;
  account: AccountPosition;
  actorOrganizationId: string;
}): InvoicePaymentPlan {
  if (
    input.invoice.organizationId !== input.actorOrganizationId ||
    input.account.organizationId !== input.actorOrganizationId
  ) {
    throw new DomainError("wrong_organization", "The invoice and account must belong to your organization");
  }
  if (input.invoice.status === "paid") {
    return { outcome: "already_paid" };
  }
  assertLedgerAmount(input.invoice.amountMinor);
  if (input.invoice.currency !== input.account.currency) {
    throw new DomainError("currency_mismatch", "Pay an invoice from an account in the same currency");
  }
  if (input.account.balanceMinor < input.invoice.amountMinor) {
    throw new DomainError("insufficient_funds", "The account does not have enough funds to pay this invoice");
  }
  return {
    outcome: "pay",
    nextBalanceMinor: input.account.balanceMinor - input.invoice.amountMinor,
  };
}

function assertLedgerAmount(amountMinor: number): void {
  try {
    assertPositiveMinor(amountMinor, "Amount");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amount must be a positive integer of minor units";
    throw new DomainError("invalid_amount", message);
  }
}
