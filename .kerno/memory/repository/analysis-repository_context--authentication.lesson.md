---
type: "analysis"
id: "analysis@repository|repository_context.authentication"
scope:
  type: "repository"
source: "repository_context"
facet: "Authentication"
review:
  verdict: "amended"
  reason: "This still describes the old localauth0 image, client_credentials, and audience https://mcp.northwharf.local. The running issuer is this repo's auth0 service and the working grant is the password grant."
  supersededText: "The local Auth0 stand-in uses image `public.ecr.aws/primaassicurazioni/localauth0:0.9.1`.\n\nThat image only accepts the built-in client `client_id` / `client_secret`.\n\nThe audience is `https://mcp.northwharf.local`.\n\nThe access token subject is `auth0|6728f0a1b2c3d4e5f6789012`, the seeded owner.\n\nMint a token with:\n\n- `POST http://localhost:3000/oauth/token`\n- `content-type: application/json`\n- body: `{\"client_id\":\"client_id\",\"client_secret\":\"client_secret\",\"audience\":\"https://mcp.northwharf.local\",\"grant_type\":\"client_credentials\"}`\n\nUse the returned `access_token` as `Authorization: Bearer <token>` on every MCP call.\n\nA missing or invalid token returns HTTP 401.\n\nA valid token without the tool permission returns an MCP tool error, not HTTP 500."
  reviewedAt: "2026-10-29T15:44:12.548517517Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

The issuer is this repo's auth0 service at http://localhost:3000, not the localauth0 image. Audience is http://localhost:8080/mcp. Mint with POST /oauth/token, grant_type password, username ada.north@northwharf.example, password AUTH0_OWNER_PASSWORD, client_id northwharf-management, client_secret AUTH0_MGMT_CLIENT_SECRET. Token sub is auth0|6728f0a1b2c3d4e5f6789012 and carries a permissions array. Send Authorization: Bearer on every MCP call. Tokens last 3600 seconds. A missing or invalid token is HTTP 401. An unknown subject is HTTP 403. A member without the tool permission is an MCP tool error.
