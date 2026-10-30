---
type: "analysis"
id: "analysis@application:mcp-demo-auth0-7e3ets|security_analysis.how-credentials-are-presented"
scope:
  type: "application"
  application: "mcp-demo-auth0-7e3ets"
source: "security_analysis"
facet: "How credentials are presented"
review:
  verdict: "agreed"
  reason: "MCP calls use Authorization Bearer. GET /health returned 200 with no token, and GET /mcp without a token returned 401."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.404694264Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

`Authorization: Bearer <JWT>` header on requests to `/mcp` (POST, GET, DELETE). `/health` requires no authentication (verified by calibration).
