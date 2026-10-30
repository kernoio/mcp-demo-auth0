---
type: "analysis"
id: "analysis@application:mcp-demo-auth0-7e3ets|security_analysis.required-environment-variables"
scope:
  type: "application"
  application: "mcp-demo-auth0-7e3ets"
source: "security_analysis"
facet: "Required environment variables"
review:
  verdict: "agreed"
  reason: "The app requirements and the AuthClient variable names match the running config."
  supersededText: null
  reviewedAt: "2026-10-29T20:45:24.535849238Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

The app process requires DATABASE_URL, AUTH0_ISSUER or AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE, and AUTH0_JWKS_URL. AUTH0_OWNER_SUBJECT is optional. The app does not read the management client. Scenarios mint with AuthClient using AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE, AUTH0_TEST_USERNAME, and AUTH0_TEST_PASSWORD. AUTH0_OWNER_EMAIL, AUTH0_OWNER_PASSWORD, AUTH0_MGMT_CLIENT_ID, and AUTH0_MGMT_CLIENT_SECRET name the same owner and client. Non-secret issuer settings are in .kerno/config.yaml under infrastructure.auth0. Secret values are only in .kerno/.env. AuthClient calls https://AUTH0_DOMAIN. This local issuer is HTTP on port 3000.

---


- No code changes between runs — all facets remain identical to previous analysis
- Verified the complete authentication chain: `createBearerAuthenticator()` at line 17-25 calls `express-oauth2-jwt-bearer.auth()` with issuer/audience/jwksUri config; installed in app setup (src/index.ts); `resolveAccess()` at line 26-42 performs the two-stage validation (JWT claims via req.auth.payload, then database member check via `memberExists()`)
- Confirmed JWT validation flow: `express-oauth2-jwt-bearer` middleware populates `req.auth.payload`, `resolveAccess()` extracts `sub` and `permissions` claims, validates `sub` is non-empty string, calls `memberExists(subject)` to verify database membership
- All MCP endpoints (`/mcp` POST/GET/DELETE) call `resolveAccess()` in their handlers (src/http/app.ts lines 65, 130+)
- `/health` endpoint has no auth middleware — verified in previous calibration
- `firstPresent()` helper (config.ts line 31-37) explains AUTH0_ISSUER vs AUTH0_ISSUER_BASE_URL — accepts either
- Environment variables confirmed in src/config.ts `readConfig()` function lines 12-21
