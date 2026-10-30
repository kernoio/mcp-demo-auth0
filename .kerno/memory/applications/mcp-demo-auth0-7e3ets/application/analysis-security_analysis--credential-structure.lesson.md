---
type: "analysis"
id: "analysis@application:mcp-demo-auth0-7e3ets|security_analysis.credential-structure"
scope:
  type: "application"
  application: "mcp-demo-auth0-7e3ets"
source: "security_analysis"
facet: "Credential structure"
review:
  verdict: "agreed"
  reason: "The local issuer signs iss, aud, sub, and a permissions array. The app checks those against AUTH0_ISSUER or AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE, and JWKS, then requires sub to match a member."
  supersededText: null
  reviewedAt: "2026-10-29T15:44:12.367780021Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
---

JWT with claims: `iss` (issuer), `aud` (audience), `sub` (subject identity), optional `permissions` array. Server validates signature using JWKS at `AUTH0_JWKS_URL`, checks `iss` equals `AUTH0_ISSUER` (or `AUTH0_ISSUER_BASE_URL`) and `aud` equals `AUTH0_AUDIENCE`. `sub` must be non-empty string matching a member row in the database via `memberExists(subject)` check. Token acquisition requires password grant with user credentials.
