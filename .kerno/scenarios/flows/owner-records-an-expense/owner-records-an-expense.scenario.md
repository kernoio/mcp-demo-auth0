<!-- generated from plan.json — do not edit; re-run kerno_endpoint_test to regenerate -->

## Owner Ada North records an expense and sees it in the organization's expense list
**Kind:** HAPPY_PATH | **Actor:** Ada North, the seeded owner of Northwharf Ltd (subject `auth0|6728f0a1b2c3d4e5f6789012`) | **Scope:** FLOW owner-records-an-expense (TOOL create_expense → TOOL list_expenses)
### Preconditions
- The Northwharf MCP server is reachable and serves `tools/call` at the SUT MCP endpoint.
- The seeded member Ada North exists in organization Northwharf Ltd (`10000000-0000-4000-8000-000000000001`) with role `owner`.
- An access token for Ada is minted in arrange via `AuthClient.getTokenByPassword` (with the HTTP URL-rewriting `customFetch`) and carries `expenses:write` and `expenses:read`.
- Postgres is reachable at `process.env.DATABASE_URL` for the cleanup delete.
### Trigger
Two authenticated MCP `tools/call` requests, in order: `create_expense` with `{ merchant: <unique per-run>, amountMinor: <unique positive integer>, currency: "GBP", category: "travel", status: "submitted" }`, then `list_expenses` with no arguments.
### Main success scenario
1. `tools/call create_expense` with the unique merchant, amount, `currency: "GBP"`, `category: "travel"`, `status: "submitted"` — HTTP 200, the tool result is not an error, and its JSON payload carries the new expense's `id`; capture that `id` for the read-back.
2. `tools/call list_expenses` with no arguments — HTTP 200, the tool result is not an error, and its JSON payload's `expenses` array is read back to locate the expense recorded in step 1 by that `id`.
### Postconditions
- Step 1 (`create_expense`, setup) responded HTTP 200 with a tool result whose `isError` is not true, and whose parsed JSON `id` is a UUID string — this is the id the final step is checked against.
- Final step (`list_expenses`) responded HTTP 200.
- The `list_expenses` tool result's `isError` is not true and `content[0].type` is `"text"` whose text parses as JSON with an `expenses` array.
- Exactly one entry in `expenses` has `id` equal to the id returned by step 1 — the expense Ada just recorded appears in the organization's expense list.
- That entry's `id` equals the `id` returned by `create_expense` in step 1.
- That entry's `memberId` is a UUID string equal to the `members.id` of the seeded owner subject `auth0|6728f0a1b2c3d4e5f6789012` (resolved from the created expense's own `memberId` returned in step 1).
- That entry's `merchant` equals the unique merchant string sent in step 1 (trimmed).
- That entry's `amountMinor` equals the amount sent in step 1 (a positive integer).
- That entry's `currency` is `"GBP"` — the currency sent in step 1, and a member of the allowed set `GBP`, `EUR`, `USD`.
- That entry's `category` equals `"travel"` — the category sent in step 1 (trimmed).
- That entry's `status` is `"submitted"` — the status sent in step 1, and a member of the allowed set `draft`, `submitted`, `approved`.
- That entry's `occurredAt` is an ISO-8601 timestamp string (anchored `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`) that parses as a real date.
- The entry has no fields beyond `id`, `memberId`, `merchant`, `amountMinor`, `currency`, `category`, `status`, `occurredAt` (assert the whole object in one deep-equality template).
- The `list_expenses` response headers match the observed baseline — `Content-Type` as observed for this MCP transport, and `Cache-Control`, `Vary`, `Set-Cookie`, `Access-Control-*`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` pinned to the observed value or pinned as absent. Do not assert `Date`, `Content-Length`, `ETag`, `Server` or any trace/request id header.
### Cleanup
- Delete the `expenses` row created by this flow directly via `DATABASE_URL` (`DELETE FROM expenses WHERE id = $1`) and verify `rowCount` is 1.
- Close the Postgres connection (`await db.end().catch(() => {})` in a `finally`).
### Notes
The MCP tool payload is the JSON text inside `content[0].text`; parse it before asserting fields. `ExpenseView` (src/db/store.ts `toExpense`) is the response contract used for the field accounting above. `list_expenses` is organization-scoped and unfiltered, so isolation comes from the unique per-run merchant/amount and from matching the entry by the id created in step 1 — never by array index.