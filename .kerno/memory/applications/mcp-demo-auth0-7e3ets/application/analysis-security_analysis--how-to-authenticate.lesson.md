---
type: "analysis"
id: "analysis@application:mcp-demo-auth0-7e3ets|security_analysis.how-to-authenticate"
scope:
  type: "application"
  application: "mcp-demo-auth0-7e3ets"
source: "security_analysis"
facet: "How to authenticate"
review:
  verdict: "agreed"
  reason: "A password grant to the local issuer returned 200, and the Northwharf process only verifies that token."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.443041461Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

Password grant OAuth 2.0 flow against the Auth0 issuer (verified by calibration). POST to `{AUTH0_ISSUER}/oauth/token` with `grant_type=password`, `username` (email), `password`, `audience`, `client_id`, and `client_secret`. The server validates user access tokens but does not issue them.
