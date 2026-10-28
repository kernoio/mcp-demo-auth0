# Northwharf

Northwharf is a small business account for one company. It keeps multi-currency balances, a ledger, team debit cards, expenses, and supplier invoices. Money is stored as integer minor units. This repository is a system under test: an HTTP service with a Streamable HTTP MCP server in front of Postgres.

## Prerequisites

- Docker with Compose
- Node.js 24 if you want to run the typecheck, tests, or migrations on the host

## Run

```bash
docker compose up --build
```

The app listens on port 8080 after Postgres and the local Auth0 stand-in are healthy. It applies the SQL migrations and loads the seed on startup. Host ports default to 5432, 3000, and 8080. If one of those is already taken, set `POSTGRES_HOST_PORT` or `AUTH0_HOST_PORT` for that `docker compose` command.

- Health: `http://localhost:8080/health`
- MCP: `http://localhost:8080/mcp`

`docker compose down` stops the stack. Add `-v` when you want the next start to load the seed again. The Postgres volume keeps the ledger between restarts, and the seed does not overwrite an organization that is already there.

## Mint a token

Auth is a local stand-in for Auth0, image `public.ecr.aws/primaassicurazioni/localauth0:0.9.1`. That image only accepts the built-in client `client_id` / `client_secret`. The audience is `https://mcp.northwharf.local`. The access token subject is `auth0|ada.north`, the seeded owner.

```bash
curl -sS -X POST http://localhost:3000/oauth/token \
  -H 'content-type: application/json' \
  -d '{"client_id":"client_id","client_secret":"client_secret","audience":"https://mcp.northwharf.local","grant_type":"client_credentials"}'
```

The JSON body has `access_token`. Send it as `Authorization: Bearer` on every MCP call.

## Call the MCP server

`list_accounts` needs `accounts:read`. `cash_snapshot` needs `treasury:read`. Both are on the token minted above. A stateless `tools/call` is enough:

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/oauth/token \
  -H 'content-type: application/json' \
  -d '{"client_id":"client_id","client_secret":"client_secret","audience":"https://mcp.northwharf.local","grant_type":"client_credentials"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

curl -sS -X POST http://localhost:8080/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}'

curl -sS -X POST http://localhost:8080/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"cash_snapshot","arguments":{}}}'
```

A missing or invalid token is HTTP 401. A valid token without the tool's permission is an MCP tool error, not an HTTP 500.

## Tools

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
pnpm dev
```

Other scripts: `pnpm test`, `pnpm typecheck`, `pnpm db:generate`. The Makefile wraps the same commands (`make test`, `make db-migrate`, and so on).

## A real Auth0 tenant

The app only checks the issuer, audience, and JWKS URL. To leave the local stand-in, change `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, and `AUTH0_JWKS_URL`. Create an API whose identifier is the audience, and grant it the permissions in the table above. The access token must use the `permissions` claim and a `sub` that matches a member row.

On that tenant, create a machine-to-machine client. `northwharf` / `northwharf-dev-secret` is a reasonable local name for it. The image used here cannot be given that client id: version 0.9.1 hardcodes `client_id` and `client_secret`, which is why the curl above uses those values. The running app does not read the client id or secret.
