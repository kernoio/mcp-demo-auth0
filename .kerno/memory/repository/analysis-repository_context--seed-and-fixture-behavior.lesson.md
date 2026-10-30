---
type: "analysis"
id: "analysis@repository|repository_context.seed-and-fixture-behavior"
scope:
  type: "repository"
source: "repository_context"
facet: "Seed and fixture behavior"
review:
  verdict: "agreed"
  reason: "Startup loads the seed, the owner subject matches, and the organization row was already present so the seed did not overwrite it."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.616825625Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

The app applies migrations and loads the seed on startup.

The seeded owner is `auth0|6728f0a1b2c3d4e5f6789012`.

The seed does not overwrite an organization that already exists.

The Postgres volume keeps the ledger between restarts, so use `docker compose down -v` when you need a fresh seed.
