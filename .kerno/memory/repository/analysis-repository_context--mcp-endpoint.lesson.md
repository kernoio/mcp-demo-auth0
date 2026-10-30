---
type: "analysis"
id: "analysis@repository|repository_context.mcp-endpoint"
scope:
  type: "repository"
source: "repository_context"
facet: "MCP endpoint"
review:
  verdict: "agreed"
  reason: "The live MCP URL is http://localhost:8080/mcp, health is unauthenticated, and the listed tool permissions match the server."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.582472788Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

The MCP server is at `http://localhost:8080/mcp`.

Health is at `http://localhost:8080/health`.

Use stateless `tools/call` requests with:

- `content-type: application/json`
- `accept: application/json, text/event-stream`
- `authorization: Bearer <token>`

Example tools:

- `list_accounts` requires `accounts:read`
- `cash_snapshot` requires `treasury:read`
