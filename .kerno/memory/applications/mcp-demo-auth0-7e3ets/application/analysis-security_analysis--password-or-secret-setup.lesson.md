---
type: "analysis"
id: "analysis@application:mcp-demo-auth0-7e3ets|security_analysis.password-or-secret-setup"
scope:
  type: "application"
  application: "mcp-demo-auth0-7e3ets"
source: "security_analysis"
facet: "Password or secret setup"
review:
  verdict: "agreed"
  reason: "The seeded owner email, subject, and owner password still match the live member, and the management client is still only used to mint tokens."
  supersededText: null
  reviewedAt: "2026-10-29T17:07:27.947431900Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

Seeded user account: email `ada.north@northwharf.example`, subject `auth0|6728f0a1b2c3d4e5f6789012`, password from `.kerno/.env` key `AUTH0_OWNER_PASSWORD`. Management API client credentials (`AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`) are used for test setup only, not by the application server.
