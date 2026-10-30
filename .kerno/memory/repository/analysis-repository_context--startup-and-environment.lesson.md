---
type: "analysis"
id: "analysis@repository|repository_context.startup-and-environment"
scope:
  type: "repository"
source: "repository_context"
facet: "Startup and environment"
review:
  verdict: "agreed"
  reason: "Compose starts Postgres, the local issuer, and the app, and the documented default ports and reseed flag match docker-compose.yml."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.653407859Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

Run the stack with `docker compose up --build`.

The service listens on port `8080` after Postgres and the local Auth0 stand-in are healthy.

The compose stack applies SQL migrations and loads the seed on startup.

Default host ports are `5432` for Postgres, `3000` for Auth0, and `8080` for the app.

Set `POSTGRES_HOST_PORT` or `AUTH0_HOST_PORT` if those ports are already in use.

Use `docker compose down` to stop the stack.

Add `-v` to force the next start to load the seed again.

The Postgres volume persists the ledger between restarts.

The seed does not overwrite an organization that already exists.

Without Docker:

copy `.env.example` to `.env`, point it at a Postgres instance you can migrate, then run `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, and `pnpm dev`.

Other available scripts are `pnpm test`, `pnpm typecheck`, and `pnpm db:generate`.

The Makefile wraps the same commands.
