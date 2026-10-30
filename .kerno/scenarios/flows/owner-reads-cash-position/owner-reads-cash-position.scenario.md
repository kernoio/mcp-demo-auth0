<!-- generated from plan.json — do not edit; re-run kerno_endpoint_test to regenerate -->

## Owner Ada North reads Northwharf Ltd's cash position — balances by currency, recent outflows and runway
**Kind:** HAPPY_PATH | **Actor:** Ada North, owner of Northwharf Ltd (auth subject `auth0|6728f0a1b2c3d4e5f6789012`) | **Scope:** FLOW owner-reads-cash-position — TOOL cash_snapshot
### Preconditions
- The Northwharf MCP server is reachable at the SUT base URL and answers stateless `tools/call` requests.
- The seeded organization Northwharf Ltd (`10000000-0000-4000-8000-000000000001`) and its owner member (auth subject from `AUTH0_OWNER_SUBJECT`, `auth0|6728f0a1b2c3d4e5f6789012`) exist; the owner member's `members.id` is looked up directly in Postgres for use as `created_by_member_id`.
- An owner access token is minted with `AuthClient.getTokenByPassword` from `@auth0/auth0-auth-js` (customFetch rewriting `https://<AUTH0_DOMAIN>` to `http://<AUTH0_DOMAIN>`, and rewriting the issuer back to `https://<AUTH0_DOMAIN>` inside the OIDC discovery JSON); the token is read as `result.accessToken` and carries `treasury:read`.
- A per-run GBP account row is seeded directly in Postgres for that organization with a unique `name` (uuid-suffixed) and a non-zero `balance_minor`.
- Two per-run transaction rows are seeded on that account with `occurred_at = now()`: one `kind = 'debit'` (counts as burn) and one `kind = 'transfer_out'` (an outflow that must not count as burn), both GBP with positive `amount_minor`.
### Trigger
MCP `tools/call` for tool `cash_snapshot` with no arguments, sent to the SUT MCP endpoint with
`Authorization: Bearer <owner access token>`.
### Main success scenario
1. TOOL cash_snapshot — call the tool as the owner; the call succeeds (no MCP tool error) and returns one `text` content part whose JSON is the cash snapshot: `asOf`, `burnWindowDays`, `currencies[]` and `recentOutflows[]`.
2. Immediately after the call, read the organization's ledger back from Postgres with independent queries — balances per currency, debit-only burn over the last 30 days, and the top-8 `debit`/`transfer_out` rows by `occurred_at` descending — to verify the reported cash position against stored state.
### Postconditions
- The MCP response is a successful tool result: `isError` is absent or `false`, `content` has exactly one entry, and that entry's `type` is `"text"`.
- The `text` content parses as JSON with exactly the keys `asOf`, `burnWindowDays`, `currencies`, `recentOutflows`.
- `asOf` is an ISO-8601 timestamp (matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`) and `Date.parse(asOf)` is not NaN.
- `burnWindowDays` is exactly `30`.
- `currencies` is a non-empty array, sorted ascending by `currency`, with one entry per distinct account currency of org `10000000-0000-4000-8000-000000000001` — and it contains an entry for `"GBP"` (the currency this run seeded).
- Each `currencies[]` entry has exactly the keys `currency`, `balanceMinor`, `burnMinor`, `runwayMonths`.
- Each `currencies[].currency` is one of `"GBP"`, `"EUR"`, `"USD"`.
- Each `currencies[].balanceMinor` equals the independent read-back `SELECT sum(balance_minor) FROM accounts WHERE organization_id = '10000000-0000-4000-8000-000000000001' GROUP BY currency` for that currency (the GBP figure therefore includes this run's seeded account balance).
- Each `currencies[].burnMinor` equals the independent read-back `SELECT coalesce(sum(amount_minor),0) FROM transactions WHERE organization_id = '10000000-0000-4000-8000-000000000001' AND kind = 'debit' AND occurred_at >= now() - interval '30 days' GROUP BY currency` for that currency — so the GBP figure includes this run's seeded debit amount and excludes this run's seeded `transfer_out` amount.
- Each `currencies[].runwayMonths` equals `Math.round((balanceMinor / burnMinor) * 100) / 100` when `burnMinor > 0`, and is exactly `null` when `burnMinor` is `0`.
- `recentOutflows` is an array of at most 8 entries and equals, in order, the independent read-back `SELECT id, account_id, kind, amount_minor, currency, description, transfer_group_id, counterparty_account_id, occurred_at FROM transactions WHERE organization_id = '10000000-0000-4000-8000-000000000001' AND kind IN ('debit','transfer_out') ORDER BY occurred_at DESC LIMIT 8` (ids in the same order, each `occurredAt` equal to the row's `occurred_at` as ISO-8601).
- Each `recentOutflows[]` entry has exactly the keys `id`, `accountId`, `kind`, `amountMinor`, `currency`, `description`, `transferGroupId`, `counterpartyAccountId`, `occurredAt`; `id` and `accountId` are UUID strings, `kind` is one of `"debit"`/`"transfer_out"`, `amountMinor` is a positive integer, `currency` is one of `"GBP"`/`"EUR"`/`"USD"`, `description` is a string, `transferGroupId` and `counterpartyAccountId` are each a UUID string or `null`, and `occurredAt` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}` with `Date.parse` not NaN.
- The snapshot body contains no credential or token material: the parsed JSON has no `token`, `accessToken`, `authorization`, `password` or `secret` property at the top level.
- The HTTP response headers match the observed baseline for the MCP endpoint (`Content-Type` as observed for a stateless `tools/call`, and `Cache-Control`, `Vary`, `Set-Cookie`, `Access-Control-Allow-Origin`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` pinned to their observed values, each pinned as absent when the endpoint does not send it). Volatile headers (`Date`, `Content-Length`, `ETag`, `Server`, request/trace ids) are not asserted.
### Cleanup
- Delete the two seeded transaction rows by id and the seeded account row by id, asserting each DELETE's `rowCount`.
- Close every Postgres connection opened by the scenario (`await db.end().catch(() => {})` in a `finally`).
### Notes
The tool takes no arguments, so the flow's only variation is the ledger state it seeds. The seeded
`debit` plus `transfer_out` pair is what makes the burn figure discriminating: a snapshot that
counted internal transfers as burn, or that ignored recent debits, would produce a different number
than the independent debit-only query.

The balances/burn cross-checks are issued immediately after the tool call against the same shared
organization; a concurrent scenario mutating the ledger between the two reads is the one source of
noise, which is why the per-run seeded rows are the discriminator rather than a frozen total. Do not
assert that this run's seeded rows occupy specific positions in `recentOutflows` — the 8-row window
is shared — assert the list against the independent top-8 query instead.

Authentication is HTTP-level (bearer token from the local Auth0 issuer) and is not tagged as a
required dependency.