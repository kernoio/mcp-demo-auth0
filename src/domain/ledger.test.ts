import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "./errors.js";
import { planInvoicePayment, planTransfer, type AccountPosition, type InvoicePosition } from "./ledger.js";
import { runwayMonths } from "./money.js";

const org = "org-1";

function account(overrides: Partial<AccountPosition> & Pick<AccountPosition, "id" | "currency">): AccountPosition {
  return {
    organizationId: org,
    balanceMinor: 10_000,
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoicePosition> = {}): InvoicePosition {
  return {
    id: "inv-1",
    organizationId: org,
    currency: "GBP",
    amountMinor: 4_000,
    status: "unpaid",
    ...overrides,
  };
}

describe("transfer rules", () => {
  const from = account({ id: "gbp-operating", currency: "GBP", balanceMinor: 10_000 });
  const to = account({ id: "gbp-tax", currency: "GBP", balanceMinor: 2_000 });

  it("moves a positive minor-unit amount between two accounts of the same currency", () => {
    assert.deepEqual(planTransfer({ from, to, amountMinor: 1_500, actorOrganizationId: org }), {
      fromBalanceMinor: 8_500,
      toBalanceMinor: 3_500,
    });
  });

  it("rejects insufficient funds", () => {
    assert.throws(
      () => planTransfer({ from, to, amountMinor: 10_001, actorOrganizationId: org }),
      (error: unknown) => error instanceof DomainError && error.code === "insufficient_funds",
    );
  });

  it("rejects a currency mismatch", () => {
    const euros = account({ id: "eur-operating", currency: "EUR", balanceMinor: 5_000 });
    assert.throws(
      () => planTransfer({ from, to: euros, amountMinor: 100, actorOrganizationId: org }),
      (error: unknown) => error instanceof DomainError && error.code === "currency_mismatch",
    );
  });

  it("rejects the same account on both sides", () => {
    assert.throws(
      () => planTransfer({ from, to: from, amountMinor: 100, actorOrganizationId: org }),
      (error: unknown) => error instanceof DomainError && error.code === "same_account",
    );
  });

  it("rejects an account outside the caller's organization", () => {
    const foreign = account({ id: "other", currency: "GBP", organizationId: "org-2" });
    assert.throws(
      () => planTransfer({ from, to: foreign, amountMinor: 100, actorOrganizationId: org }),
      (error: unknown) => error instanceof DomainError && error.code === "wrong_organization",
    );
  });

  it("rejects a zero, fractional, or negative amount", () => {
    for (const amountMinor of [0, -1, 1.5]) {
      assert.throws(
        () => planTransfer({ from, to, amountMinor, actorOrganizationId: org }),
        (error: unknown) => error instanceof DomainError && error.code === "invalid_amount",
      );
    }
  });
});

describe("pay-invoice idempotency", () => {
  const operating = account({ id: "gbp-operating", currency: "GBP", balanceMinor: 500 });

  it("plans a single debit when the invoice is unpaid and the account can cover it", () => {
    assert.deepEqual(
      planInvoicePayment({
        invoice: invoice({ amountMinor: 400 }),
        account: operating,
        actorOrganizationId: org,
      }),
      { outcome: "pay", nextBalanceMinor: 100 },
    );
  });

  it("returns already paid and does not ask for funds when the invoice is paid", () => {
    const empty = account({ id: "gbp-operating", currency: "GBP", balanceMinor: 0 });
    assert.deepEqual(
      planInvoicePayment({
        invoice: invoice({ status: "paid", amountMinor: 400 }),
        account: empty,
        actorOrganizationId: org,
      }),
      { outcome: "already_paid" },
    );
  });

  it("stays already paid on a second plan", () => {
    const paid = invoice({ status: "paid" });
    const first = planInvoicePayment({ invoice: paid, account: operating, actorOrganizationId: org });
    const second = planInvoicePayment({ invoice: paid, account: operating, actorOrganizationId: org });
    assert.deepEqual(first, { outcome: "already_paid" });
    assert.deepEqual(second, first);
  });

  it("rejects an unpaid invoice the account cannot cover", () => {
    assert.throws(
      () =>
        planInvoicePayment({
          invoice: invoice({ amountMinor: 501 }),
          account: operating,
          actorOrganizationId: org,
        }),
      (error: unknown) => error instanceof DomainError && error.code === "insufficient_funds",
    );
  });

  it("rejects paying from a different currency", () => {
    assert.throws(
      () =>
        planInvoicePayment({
          invoice: invoice({ currency: "EUR" }),
          account: operating,
          actorOrganizationId: org,
        }),
      (error: unknown) => error instanceof DomainError && error.code === "currency_mismatch",
    );
  });
});

describe("cash runway", () => {
  it("rounds months to two decimals and returns null when there is no burn", () => {
    assert.equal(runwayMonths(1_000, 400), 2.5);
    assert.equal(runwayMonths(1, 3), 0.33);
    assert.equal(runwayMonths(5_000, 0), null);
  });
});
