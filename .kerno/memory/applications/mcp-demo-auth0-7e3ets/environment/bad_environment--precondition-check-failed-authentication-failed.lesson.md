---
type: "lesson"
id: "bad_environment@environment:mcp-demo-auth0-7e3ets|precondition-check-failed-authentication-failed-"
scope:
  type: "environment"
  application: "mcp-demo-auth0-7e3ets"
faultClass: "bad_environment"
confidence: 0
evidence:
- application: "mcp-demo-auth0-7e3ets"
  method: "FLOW"
  path: "owner-reads-cash-position"
  cohorts:
  - dimension: "path_prefix"
    value: "owner-reads-cash-position"
  crossedEndpoints:
  - method: "TOOL"
    path: "cash_snapshot"
- application: "mcp-demo-auth0-7e3ets"
  method: "FLOW"
  path: "owner-pays-a-supplier-invoice"
  cohorts:
  - dimension: "path_prefix"
    value: "owner-pays-a-supplier-invoice"
  crossedEndpoints:
  - method: "TOOL"
    path: "list_invoices"
  - method: "TOOL"
    path: "pay_invoice"
  - method: "TOOL"
    path: "get_invoice"
subjects: []
learnedAtCodeRef: "d0a91614d5579d94357c6298766ee983d3db4ea4"
mintedAt: "2026-10-29T16:43:01.056051807Z"
mintedByAgentVersion: "latest-dev"
review:
  verdict: "agreed"
  reason: "The cash-position flow aborted in its precondition for the same HTTPS fetch failure. That is the environment, not cash_snapshot."
  supersededText: null
  reviewedAt: "2026-10-29T17:07:28.094555582Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
derivedFrom:
  at:
    application: "mcp-demo-auth0-7e3ets"
    method: "FLOW"
    path: "owner-reads-cash-position"
    cohorts:
    - dimension: "path_prefix"
      value: "owner-reads-cash-position"
    crossedEndpoints:
    - method: "TOOL"
      path: "cash_snapshot"
  scenarioIds: []
  observedStatus: null
  subjectVerified: false
  faultSignature: "precondition check failed: Authentication failed: fetch failed: expected […] to have a length of 0 but got […]"
removed: true
---

A previous endpoint test on `mcp-demo-auth0-7e3ets` aborted before running any scenario: precondition check failed: Authentication failed: Error: BLOCKED: Auth0 HTTPS fetch failed (local issuer is HTTP-only on port 3000): TypeError: fetch failed: expected […] to have a length of 0 but got […]. Confirm the environment is healthy before assuming a failing scenario is a SUT defect.
