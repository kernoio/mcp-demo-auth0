---
type: "lesson"
id: "bad_scenario@flow:mcp-demo-auth0-7e3ets:owner-reads-cash-position|authentication-failed-gettokenbypassword-must-re"
scope:
  type: "flow"
  application: "mcp-demo-auth0-7e3ets"
  flow: "owner-reads-cash-position"
  endpoints:
  - method: "TOOL"
    path: "cash_snapshot"
faultClass: "bad_scenario"
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
subjects: []
learnedAtCodeRef: "d0a91614d5579d94357c6298766ee983d3db4ea4"
mintedAt: "2026-10-29T20:30:23.520492978Z"
mintedByAgentVersion: "latest-dev"
review:
  verdict: "disagreed"
  reason: "That precondition failed once because it did not read result.accessToken. The flow was regenerated with AuthClient and the https-to-http rewrite, and cash_snapshot then passed."
  supersededText: null
  reviewedAt: "2026-10-29T20:45:24.579111990Z"
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
  faultSignature: "Authentication failed: getTokenByPassword must return an access_token: expected to be truthy: expected […] to have a length of 0 but got […]"
---

A previous endpoint test on `FLOW owner-reads-cash-position` never ran a scenario: the precondition Kerno authored could not be satisfied — Authentication failed: getTokenByPassword must return an access_token: expected to be truthy: expected […] to have a length of 0 but got […]. The environment was answering, so this is a scenario-authoring fault, not a SUT defect. Check that the precondition asserts only what a test client can establish for itself before planning around it again.
