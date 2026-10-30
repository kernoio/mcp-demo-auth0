<!-- generated from plan.json — do not edit; re-run kerno_endpoint_test to regenerate -->

## The owner freezes her own debit card and reads it back as frozen
**Kind:** HAPPY_PATH | **Actor:** Ada North, seeded owner of Northwharf Ltd (subject `auth0|6728f0a1b2c3d4e5f6789012`, organization `10000000-0000-4000-8000-000000000001`) | **Scope:** FLOW owner-freezes-a-debit-card (TOOL list_cards → TOOL set_card_status → TOOL list_cards)
### Preconditions
- The MCP server is reachable: the base URL with the trailing `/mcp` removed plus `/health` answers 200.
- An owner access token is minted with `AuthClient.getTokenByPassword({ username: AUTH0_TEST_USERNAME, password: AUTH0_TEST_PASSWORD, audience: AUTH0_AUDIENCE })` using `AUTH0_DOMAIN`/`AUTH0_CLIENT_ID`/`AUTH0_CLIENT_SECRET` and a `customFetch` that rewrites only the request URL scheme/host; the token is read as `result.accessToken` and sent as `Authorization: Bearer` on every `tools/call`.
- Card `10000000-0000-4000-8000-000000000041` (Ada's card, last four 4412, GBP) is set to `status = 'active'` directly in Postgres via `DATABASE_URL`, so the freeze is an observable transition rather than a no-op.
### Trigger
The ordered walk: `tools/call list_cards` (no arguments) → `tools/call set_card_status` with `{ cardId: "10000000-0000-4000-8000-000000000041", status: "frozen" }` → `tools/call list_cards` (no arguments), all as Ada over Streamable HTTP MCP at `SUT_BASE_URL`.
### Main success scenario
1. `TOOL list_cards` — Ada lists the organization's cards; the call succeeds (HTTP 200, `isError` not true) and the parsed `cards` array contains an entry whose `id` is `10000000-0000-4000-8000-000000000041` with `status: "active"`. Carry that card's `id` into the next step.
2. `TOOL set_card_status` — Ada calls `set_card_status` with the carried `cardId` and `status: "frozen"`; the call succeeds (HTTP 200, `isError` not true) and the returned card's `id` equals the carried id and its `status` is `"frozen"`.
3. `TOOL list_cards` — Ada lists the cards again; this is the step the flow is about. Its response is asserted in full for the card under test, and the `cards` row is read back from Postgres to prove the freeze persisted.
### Postconditions
- Step 1 (fixture): the `list_cards` call returns HTTP 200 with `isError` not true, and the `cards` array contains an entry with `id` `10000000-0000-4000-8000-000000000041` whose `status` is `"active"` — the id this flow carries forward.
- Step 2 (fixture): the `set_card_status` call returns HTTP 200 with `isError` not true, and the returned card's `id` is `10000000-0000-4000-8000-000000000041` and its `status` is `"frozen"`.
- Final step — transport: the second `list_cards` call returns HTTP 200.
- Final step — envelope: the tool result's `isError` is not true, and `content[0].type` is `"text"` whose text parses as JSON with exactly one top-level key, `cards`, holding an array.
- Final step — `cards` is an array containing exactly one entry whose `id` is `10000000-0000-4000-8000-000000000041`.
- Final step — that entry equals, field for field: `id` is `"10000000-0000-4000-8000-000000000041"`; `memberId` is Ada's member id as returned by step 1 for the same card (the value is stable across the flow, so pin it to step 1's observed value); `accountId` equals the `accountId` step 1 returned for this card; `lastFour` is `"4412"`; `status` is `"frozen"` — the business outcome the flow is about; `spendingLimitMinor` equals the value step 1 returned for this card (the flow never changes the limit); `currency` is `"GBP"`. No other properties are present on the entry.
- Final step — the card entry does not expose a full card number or any PAN-like field: it has no `number`, `pan`, `cvv` or `expiry` property.
- Final step — isolation of the sibling card: the `cards` array still contains the entry for `10000000-0000-4000-8000-000000000042` (Ben's card) and its `status` is `"frozen"` as the seed left it; no card in the array has `status` `"cancelled"`.
- Persisted state: `SELECT status, spending_limit_minor, last_four, currency FROM cards WHERE id = '10000000-0000-4000-8000-000000000041'` returns exactly one row whose `status` is `'frozen'`, whose `spending_limit_minor` is unchanged from the value observed in step 1, whose `last_four` is `'4412'` and whose `currency` is `'GBP'`.
- Response headers: the final `list_cards` HTTP response headers match the observed baseline for this MCP endpoint — pin `Content-Type` as observed (the Streamable HTTP transport answers `application/json` or `text/event-stream`; pin the one this run returns), pin `Cache-Control` and `Vary` as observed, and pin as ABSENT any of `Set-Cookie`, `Access-Control-Allow-Origin`, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` that the endpoint does not send. Do not assert `Date`, `Content-Length`, `ETag`, `Server` or any request/trace id.
- Negative: no response body in the flow contains a stack frame, absolute filesystem path, SQL or ORM driver text, or an exception class name.
### Cleanup
- Restore card `10000000-0000-4000-8000-000000000041` to `status = 'active'` with a direct `UPDATE … WHERE id = …` on Postgres and verify the update affected exactly one row, so the flow can run again from the same starting state.
- Close the Postgres connection(s) opened by the scenario.
### Notes
Ben's card `10000000-0000-4000-8000-000000000042` is already frozen by the seed and must not be used as the card this flow freezes; no card may be set to `cancelled`. The card entry's field list is derived from `toCard` in `src/db/store.ts` (`id`, `memberId`, `accountId`, `lastFour`, `status`, `spendingLimitMinor`, `currency`). `memberId`, `accountId` and `spendingLimitMinor` are pinned to the values step 1 observed rather than to hardcoded literals, because only the card id, last four, currency and status are stated by the flow context.