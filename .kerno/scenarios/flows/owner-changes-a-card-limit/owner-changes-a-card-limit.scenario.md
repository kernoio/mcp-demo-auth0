<!-- generated from plan.json — do not edit; re-run kerno_endpoint_test to regenerate -->

## The owner changes her debit card's spending limit and sees the new limit when she lists her cards
**Kind:** HAPPY_PATH | **Actor:** Ada North, the seeded owner of Northwharf Ltd (subject `auth0|6728f0a1b2c3d4e5f6789012`) | **Scope:** FLOW owner-changes-a-card-limit (TOOL list_cards → TOOL set_card_limit → TOOL list_cards)
### Preconditions
- The Northwharf MCP server is reachable and serves stateless `tools/call` requests at the SUT MCP endpoint.
- Ada North exists as an owner member of Northwharf Ltd (`10000000-0000-4000-8000-000000000001`) and an access token minted for her by the local Auth0 issuer via the password grant carries `cards:read` and `cards:manage`.
- The seeded card `10000000-0000-4000-8000-000000000041` (last four `4412`) exists for that organization.
### Trigger
Ada calls `tools/call list_cards`, then `tools/call set_card_limit` with `{ cardId: "10000000-0000-4000-8000-000000000041", spendingLimitMinor: <fresh positive integer generated for this run, different from the limit observed in step 1> }`, then `tools/call list_cards` again — every call carrying `Authorization: Bearer <Ada's access token>`.
### Main success scenario
1. `TOOL list_cards` — Ada lists the organization's cards; the call succeeds and the response contains an entry whose `id` is `10000000-0000-4000-8000-000000000041`. Capture that entry's `spendingLimitMinor` as the pre-change limit and its `memberId`, `accountId`, `lastFour`, `status` and `currency` as the values the change must leave untouched.
2. `TOOL set_card_limit` — Ada sets that card's `spendingLimitMinor` to the fresh per-run amount; the call succeeds (not an MCP tool error) and the returned card's `id` and `spendingLimitMinor` are the ones sent.
3. `TOOL list_cards` — Ada lists the cards again and reads the card back; this is the step the flow is about and its response is asserted in full.
### Postconditions
- Step 1 (`list_cards`, fixture): the tool call succeeded — the result is not an MCP tool error — and its parsed `cards` array contains exactly one entry whose `id` is `10000000-0000-4000-8000-000000000041`; that entry's `spendingLimitMinor` is an integer (the pre-change limit the flow carries forward).
- Step 2 (`set_card_limit`, fixture): the tool call succeeded — the result is not an MCP tool error — and the parsed card's `id` equals the `cardId` sent and its `spendingLimitMinor` equals the `spendingLimitMinor` sent.
- Step 3, outcome: the final `list_cards` result is not an MCP tool error (`isError` is not true) and its `content` is a single `{ type: "text" }` entry whose `text` parses as JSON with exactly the key `cards`, an array.
- Step 3, outcome: the final `cards` array contains exactly one entry with `id` `10000000-0000-4000-8000-000000000041`.
- Step 3, the business outcome the user named: that entry's `spendingLimitMinor` equals the `spendingLimitMinor` sent in step 2, and is NOT the pre-change limit captured in step 1.
- Step 3, field accounting for that card entry — the entry equals exactly `{ id, memberId, accountId, lastFour, status, spendingLimitMinor, currency }` with: `id` equal to `10000000-0000-4000-8000-000000000041`; `memberId` equal to the `memberId` seen in step 1 (a UUID string); `accountId` equal to the `accountId` seen in step 1 (a UUID string); `lastFour` equal to `"4412"`; `status` equal to the `status` seen in step 1 and a member of `["active", "frozen", "cancelled"]`; `spendingLimitMinor` the amount sent in step 2; `currency` equal to the `currency` seen in step 1 and a member of `["GBP", "EUR", "USD"]`. No other key is present on the entry.
- Step 3, response headers: the HTTP response headers of the final `tools/call` match the observed baseline — pin `Content-Type` as observed (the MCP Streamable HTTP endpoint answers `application/json` or `text/event-stream`), and pin as absent any of `Cache-Control`, `Vary`, `Set-Cookie`, `Access-Control-Allow-Origin`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` the endpoint does not send. If the MCP client used to make the call does not expose response headers, record that as a declared gap in the finding rather than inventing values. Never assert `Date`, `Content-Length`, `ETag` or trace ids.
- Persisted state: the `cards` row with `id = '10000000-0000-4000-8000-000000000041'` has `spending_limit_minor` equal to the amount sent in step 2 and `organization_id` `10000000-0000-4000-8000-000000000001`.
### Cleanup
- Restore the seeded limit: `UPDATE cards SET spending_limit_minor = 500000 WHERE id = '10000000-0000-4000-8000-000000000041'`, asserting `rowCount` is 1.
- Close the Postgres connection (`await db.end().catch(() => {})` inside a `finally`).
### Notes
The MCP tool layer reports business failures as a tool result with `isError: true` and a `{ error, message }` JSON text body rather than a non-2xx HTTP status, so success is judged on `isError`/the parsed payload, not on the HTTP status alone.

The card under test is seeded and shared — there is no way to create a fresh card through the exposed tools. Use a fresh per-run `spendingLimitMinor` (e.g. a random integer in a band well away from 500000) so the asserted value is distinct from the seeded one, and restore 500000 in cleanup. Two concurrent runs of this flow against the same card would interfere; that is inherent to a single seeded fixture row and is noted rather than engineered around.

The card entry's field list is taken from `toCard` in `src/db/store.ts` (`id`, `memberId`, `accountId`, `lastFour`, `status`, `spendingLimitMinor`, `currency`); the enum sets come from the `cards_status` and `cards_currency` CHECK constraints in `drizzle/0000_lovely_bug.sql`.