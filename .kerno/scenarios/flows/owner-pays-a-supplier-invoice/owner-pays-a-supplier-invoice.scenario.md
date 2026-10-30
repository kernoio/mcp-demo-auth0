<!-- generated from plan.json — do not edit; re-run kerno_endpoint_test to regenerate -->

## Owner Ada North pays the Low Street Print supplier invoice and reads it back as paid
**Kind:** HAPPY_PATH | **Actor:** Ada North, the seeded owner of Northwharf Ltd (subject `auth0|6728f0a1b2c3d4e5f6789012`) | **Scope:** FLOW owner-pays-a-supplier-invoice (TOOL list_invoices → TOOL pay_invoice → TOOL get_invoice)
### Preconditions
- The Northwharf MCP server is reachable and serving stateless `tools/call` requests at the SUT base URL.
- An owner access token for Ada North is minted via `AuthClient.getTokenByPassword` with the `customFetch` https→http rewrite for the local issuer; it carries `invoices:read` and `invoices:pay`.
- Postgres is reachable at `process.env.DATABASE_URL`, and the invoice `10000000-0000-4000-8000-000000000061` (Low Street Print, 240000 GBP) is reset directly in the database to `status = 'unpaid'` with `paid_from_account_id`, `paid_transaction_id` and `paid_at` all NULL; any ledger debit row left by a previous run of this flow is deleted and its amount credited back to the Operating GBP account.
- The Operating GBP account `10000000-0000-4000-8000-000000000021` exists in Northwharf Ltd, is in GBP, and its `balance_minor` is at least the invoice amount (240000) — top it up directly in the database if it is not.
### Trigger
Three authenticated MCP `tools/call` requests, in order, each with `Authorization: Bearer <owner token>`: `list_invoices` (no arguments) → `pay_invoice` with `{ invoiceId: "10000000-0000-4000-8000-000000000061", accountId: "10000000-0000-4000-8000-000000000021" }` → `get_invoice` with `{ invoiceId: "10000000-0000-4000-8000-000000000061" }`.
### Main success scenario
1. `TOOL list_invoices` — Ada lists the organization's supplier invoices; the call succeeds (not an MCP tool error) and the returned `invoices` array contains an entry whose `id` is `10000000-0000-4000-8000-000000000061` with `status` `"unpaid"`; the flow carries that entry's `id`, `amountMinor` and `currency` forward.
2. `TOOL pay_invoice` — Ada pays that invoice from the Operating GBP account `10000000-0000-4000-8000-000000000021`; the call succeeds, `alreadyPaid` is `false`, and the flow carries the returned `transactionId` forward as the expected `paidTransactionId`.
3. `TOOL get_invoice` — Ada reads the same invoice back by id; this is the step the flow is about, and its full `InvoiceView` response is asserted field by field below.
### Postconditions
- Step 1 `list_invoices` is not an MCP tool error (`isError` is not true) and its parsed payload contains an `invoices` array holding exactly one entry with `id` `"10000000-0000-4000-8000-000000000061"`, whose `status` is `"unpaid"` at that moment.
- Step 2 `pay_invoice` is not an MCP tool error, its parsed payload has `alreadyPaid` `false`, and `transactionId` is a UUID string — the value later steps consume.
- Step 3 response body `id` is `"10000000-0000-4000-8000-000000000061"` — the invoice the flow paid.
- Step 3 response body `status` is `"paid"` — the business outcome the user named.
- Step 3 response body `paidFromAccountId` is `"10000000-0000-4000-8000-000000000021"`, the Operating GBP account the payment was made from.
- Step 3 response body `paidTransactionId` equals the `transactionId` returned by `pay_invoice` in step 2.
- Step 3 response body `paidAt` is a non-null ISO-8601 timestamp string (anchored `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}` pattern) and `Date.parse(paidAt)` is not NaN.
- Step 3 response body `counterparty` is `"Low Street Print"` and equals the `counterparty` seen for this invoice in step 1's list.
- Step 3 response body `amountMinor` is `240000` and equals the `amountMinor` seen for this invoice in step 1's list.
- Step 3 response body `currency` is `"GBP"`, a member of the allowed set `GBP | EUR | USD`.
- Step 3 response body `dueOn` is a `YYYY-MM-DD` date string (anchored `^\d{4}-\d{2}-\d{2}$`) and equals the `dueOn` seen for this invoice in step 1's list.
- Step 3's parsed invoice object has exactly the `InvoiceView` keys `id`, `counterparty`, `amountMinor`, `currency`, `dueOn`, `status`, `paidFromAccountId`, `paidTransactionId`, `paidAt` and no others — asserted as one `toEqual` over the whole object with `paidAt` masked by `expect.stringMatching`.
- Step 3's MCP result is not an error result: `isError` is not true, and `content[0].type` is `"text"`.
- Persisted state, read back directly from Postgres after step 3: the `invoices` row with id `10000000-0000-4000-8000-000000000061` has `status = 'paid'`, `paid_from_account_id = '10000000-0000-4000-8000-000000000021'`, `paid_transaction_id` equal to step 2's `transactionId`, and a non-null `paid_at`.
- Persisted state: exactly one `transactions` row exists with `id` equal to step 2's `transactionId`, with `kind = 'debit'`, `amount_minor = 240000`, `currency = 'GBP'`, `account_id = '10000000-0000-4000-8000-000000000021'`, `description = 'Supplier payment — Low Street Print'` and `organization_id = '10000000-0000-4000-8000-000000000001'`.
- Persisted state: the Operating GBP account's `balance_minor` equals the balance recorded in arrange minus 240000.
- The HTTP response of the final `tools/call` carries the observed baseline headers — `content-type` as the MCP transport sends it — and the behavioural headers (`Cache-Control`, `Vary`, `Set-Cookie`, `Access-Control-*`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) match the observed baseline, each one the server does not send pinned as absent. If the MCP client used for the call does not expose response headers, record that as a declared gap in the finding rather than inventing values.
- No response payload in the flow contains a stack frame, absolute filesystem path, SQL or ORM driver text, or exception class name.
### Cleanup
- Restore the baseline directly in Postgres: set the `invoices` row `10000000-0000-4000-8000-000000000061` back to `status = 'unpaid'` with `paid_from_account_id`, `paid_transaction_id` and `paid_at` NULL; delete the `transactions` row created by step 2 (verify `rowCount` is 1); credit 240000 back to the Operating GBP account `10000000-0000-4000-8000-000000000021`.
- Close the Postgres connection (`await db.end().catch(() => {})` inside a `finally`) and close the MCP client.
### Notes
The seeded ledger persists across runs and this flow mutates the one invoice the user named, so the scenario is NOT parallel-safe against another run of itself: the arrange reset plus the verified cleanUp restore are what make it deterministic and repeatable. Use the named seed ids rather than creating a fresh invoice — the request-specific context pins them. Response field names come from `InvoiceView` in `src/db/store.ts` (lines 54-64) and from the `payInvoice` return type (lines 313-317). Tool errors surface as an MCP result with `isError: true` and a JSON `{ error, message }` text block, not as an HTTP error status.