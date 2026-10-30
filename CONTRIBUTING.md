# Contributing

Northwharf is the MCP server in this repository. The public demo path, including how to run it with Kerno, is in [README.md](README.md). This page is how to run the server itself.

## Prerequisites

- Docker with Compose, to run the full stack
- Node.js 24, to run the typecheck, unit tests, or the app on the host without Docker

## Run Northwharf

```bash
docker compose up --build
```

The app listens on port 8080 after Postgres and the Auth0 issuer are healthy. Startup applies the SQL migrations and loads the seed. Host ports default to 5432 (Postgres), 3000 (Auth0), and 8080 (the app). If one of those is taken, set the matching variable for that command:

```bash
AUTH0_HOST_PORT=3011 POSTGRES_HOST_PORT=5433 docker compose up --build
```

- Health: `http://localhost:8080/health`
- MCP: `http://localhost:8080/mcp`
- Sign up: `http://localhost:3000/signup`
- Sign in: `http://localhost:3000/login`

`docker compose down` stops the stack. Add `-v` when the next start should load the seed again. The Postgres volume keeps the ledger between restarts, and the seed does not overwrite an organization that is already there.

Accounts created in the browser live in the Auth0 process. Restarting that container forgets them. The seeded owner is created again on startup. A member row stays in Postgres until you reset the database. The seeded owner is Ada North, `ada.north@northwharf.example` / `ada-north-local`.

## Call the MCP server

Use that exact MCP URL. The local issuer is `http://localhost:3000`. The API audience, which is also the OAuth resource, is `http://localhost:8080/mcp`. An access token lasts one hour.

From Cursor, add an MCP server at `http://localhost:8080/mcp` and leave the bearer token empty. Cursor opens the authorization page. Sign in as Ada, review the permissions, and choose **Allow connection**.

From a script, mint Ada's token with the password grant, then send it on every call. Replace `3000` with `AUTH0_HOST_PORT` when the issuer is forwarded elsewhere. The client id and secret below are the local-dev defaults from `.env.example`.

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"password","username":"ada.north@northwharf.example","password":"ada-north-local","audience":"http://localhost:8080/mcp","client_id":"northwharf-management","client_secret":"northwharf-management-secret"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

curl -sS -X POST http://localhost:8080/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

A missing, expired, or wrong-audience token is HTTP 401 before any tool runs. A token whose subject is not a member is HTTP 403. A member without the tool's permission gets an MCP tool error.

### Tools

| Tool | Permission |
| --- | --- |
| `whoami` | valid token for a known member |
| `list_accounts`, `get_account`, `list_transactions` | `accounts:read` |
| `create_transfer` | `transfers:write` |
| `list_expenses` | `expenses:read` |
| `create_expense` | `expenses:write` |
| `list_invoices`, `get_invoice` | `invoices:read` |
| `pay_invoice` | `invoices:pay` |
| `list_cards` | `cards:read` |
| `set_card_status`, `set_card_limit` | `cards:manage` |
| `cash_snapshot` | `treasury:read` |

`cash_snapshot` sums balances by currency, lists recent outflows, and derives burn from ledger debits in the last 30 days. Runway is that balance divided by burn. Internal transfers are not burn.

## Without Docker

Copy `.env.example` to `.env` and point it at a Postgres you can migrate. Then:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
```

Run `pnpm identity` in one terminal and `pnpm dev` in another. `pnpm identity` is the Auth0 issuer on `AUTH0_PORT` (default 3000). `AUTH0_JWKS_URL` must point at that process.

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm db:generate`. The Makefile wraps the same commands.

## A real Auth0 tenant

Set these instead of the local issuer. `AUTH0_ISSUER_BASE_URL` is the token issuer (the app also accepts `AUTH0_ISSUER`). `AUTH0_JWKS_URL` is fetched on its own, so it can use a different host. The browser signup and consent pages belong to the local issuer. A real tenant replaces that issuer, and the consent screen is Auth0's.

```bash
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
AUTH0_AUDIENCE=https://mcp.northwharf.local
AUTH0_JWKS_URL=https://your-tenant.us.auth0.com/.well-known/jwks.json
```

Create an API whose identifier is the audience, and grant it the permissions in the table above. The access token must be a user access token: `permissions` carries the grants, and `sub` is the Auth0 user id of a member row. Create that user in the Auth0 dashboard or with the Management API, and insert the matching member. The app does not read a client id or client secret. Minting the user's token stays outside the request path.
