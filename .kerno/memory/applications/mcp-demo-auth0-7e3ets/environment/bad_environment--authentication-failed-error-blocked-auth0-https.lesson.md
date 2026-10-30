---
type: "lesson"
id: "bad_environment@environment:mcp-demo-auth0-7e3ets|authentication-failed-error-blocked-auth0-https-"
scope:
  type: "environment"
  application: "mcp-demo-auth0-7e3ets"
faultClass: "bad_environment"
confidence: 1
evidence:
- application: "mcp-demo-auth0-7e3ets"
  method: "FLOW"
  path: "owner-records-an-expense"
  cohorts:
  - dimension: "path_prefix"
    value: "owner-records-an-expense"
  crossedEndpoints:
  - method: "TOOL"
    path: "create_expense"
  - method: "TOOL"
    path: "list_expenses"
- application: "mcp-demo-auth0-7e3ets"
  method: "FLOW"
  path: "owner-moves-money-between-accounts"
  cohorts:
  - dimension: "path_prefix"
    value: "owner-moves-money-between-accounts"
  crossedEndpoints:
  - method: "TOOL"
    path: "list_accounts"
  - method: "TOOL"
    path: "create_transfer"
subjects: []
learnedAtCodeRef: "d0a91614d5579d94357c6298766ee983d3db4ea4"
mintedAt: "2026-10-29T16:48:23.594858264Z"
mintedByAgentVersion: "latest-dev"
review:
  verdict: "agreed"
  reason: "The expense flow aborted in authentication before any scenario ran. AuthClient requested https://localhost:3000 and this issuer is HTTP."
  supersededText: null
  reviewedAt: "2026-10-29T17:07:28.052569397Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
derivedFrom:
  at:
    application: "mcp-demo-auth0-7e3ets"
    method: "FLOW"
    path: "owner-records-an-expense"
    cohorts:
    - dimension: "path_prefix"
      value: "owner-records-an-expense"
    crossedEndpoints:
    - method: "TOOL"
      path: "create_expense"
    - method: "TOOL"
      path: "list_expenses"
  scenarioIds: []
  observedStatus: null
  subjectVerified: false
  faultSignature: "Authentication failed: Error: BLOCKED: Auth0 HTTPS fetch failed (local issuer is HTTP-only on port 3000): TypeError: fetch failed: expected […] to have a length of 0 but got […]"
removed: true
---

A previous endpoint test on `mcp-demo-auth0-7e3ets` aborted before running any scenario: Authentication failed: Error: BLOCKED: Auth0 HTTPS fetch failed (local issuer is HTTP-only on port 3000): TypeError: fetch failed. Confirm the environment is healthy before assuming a failing scenario is a SUT defect.
