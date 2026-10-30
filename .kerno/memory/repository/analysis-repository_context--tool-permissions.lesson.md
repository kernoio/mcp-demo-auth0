---
type: "analysis"
id: "analysis@repository|repository_context.tool-permissions"
scope:
  type: "repository"
source: "repository_context"
facet: "Tool permissions"
review:
  verdict: "agreed"
  reason: "The permission list matches the tools registered in src/mcp/server.ts, including cards:manage for set_card_limit."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.704825979Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

- `whoami` — valid token for a known member
- `list_accounts`, `get_account`, `list_transactions` — `accounts:read`
- `create_transfer` — `transfers:write`
- `list_expenses` — `expenses:read`
- `create_expense` — `expenses:write`
- `list_invoices`, `get_invoice` — `invoices:read`
- `pay_invoice` — `invoices:pay`
- `list_cards` — `cards:read`
- `set_card_status`, `set_card_limit` — `cards:manage`
- `cash_snapshot` — `treasury:read`

`cash_snapshot` sums balances by currency, lists recent outflows, and derives burn from ledger debits in the last 30 days.

Internal transfers are not burn.
