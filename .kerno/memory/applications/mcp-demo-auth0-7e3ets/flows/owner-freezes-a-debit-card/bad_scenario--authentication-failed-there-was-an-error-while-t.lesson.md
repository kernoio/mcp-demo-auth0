---
type: "lesson"
id: "bad_scenario@flow:mcp-demo-auth0-7e3ets:owner-freezes-a-debit-card|authentication-failed-there-was-an-error-while-t"
scope:
  type: "flow"
  application: "mcp-demo-auth0-7e3ets"
  flow: "owner-freezes-a-debit-card"
  endpoints:
  - method: "TOOL"
    path: "list_cards"
  - method: "TOOL"
    path: "set_card_status"
faultClass: "bad_scenario"
confidence: 0
evidence:
- application: "mcp-demo-auth0-7e3ets"
  method: "FLOW"
  path: "owner-freezes-a-debit-card"
  cohorts:
  - dimension: "path_prefix"
    value: "owner-freezes-a-debit-card"
  crossedEndpoints:
  - method: "TOOL"
    path: "list_cards"
  - method: "TOOL"
    path: "set_card_status"
subjects: []
learnedAtCodeRef: "ace9479b0eddc6c733e4c02e6fbeb346835b1e06"
mintedAt: "2026-10-30T12:13:12.885976194Z"
mintedByAgentVersion: "latest-dev"
review:
  verdict: "agreed"
  reason: "The precondition never minted a token. The stack was up: a direct password grant and set_card_status both returned 200. The authored customFetch rewrote the OIDC discovery body from http to https, which the working invoice and expense flows do not do."
  supersededText: null
  reviewedAt: "2026-10-30T12:14:20.288753697Z"
  reviewedBy: "calling_agent"
  reviewedByAgentVersion: "latest-dev"
derivedFrom:
  at:
    application: "mcp-demo-auth0-7e3ets"
    method: "FLOW"
    path: "owner-freezes-a-debit-card"
    cohorts:
    - dimension: "path_prefix"
      value: "owner-freezes-a-debit-card"
    crossedEndpoints:
    - method: "TOOL"
      path: "list_cards"
    - method: "TOOL"
      path: "set_card_status"
  scenarioIds: []
  observedStatus: null
  subjectVerified: false
  faultSignature: "Authentication failed: There was an error while trying to request a token.: expected […] to have a length of 0 but got […]"
---

A previous endpoint test on `FLOW owner-freezes-a-debit-card` never ran a scenario: the precondition Kerno authored could not be satisfied — Authentication failed: There was an error while trying to request a token.: expected […] to have a length of 0 but got […]. The environment was answering, so this is a scenario-authoring fault, not a SUT defect. Check that the precondition asserts only what a test client can establish for itself before planning around it again.
