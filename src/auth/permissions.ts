export const ownerSubject = "auth0|ada.north";

export const accessPermissions = [
  "accounts:read",
  "transfers:write",
  "expenses:read",
  "expenses:write",
  "invoices:read",
  "invoices:pay",
  "cards:read",
  "cards:manage",
  "treasury:read",
] as const;

export type AccessPermission = (typeof accessPermissions)[number];

export const permission = {
  accountsRead: "accounts:read",
  transfersWrite: "transfers:write",
  expensesRead: "expenses:read",
  expensesWrite: "expenses:write",
  invoicesRead: "invoices:read",
  invoicesPay: "invoices:pay",
  cardsRead: "cards:read",
  cardsManage: "cards:manage",
  treasuryRead: "treasury:read",
} as const satisfies Record<string, AccessPermission>;
