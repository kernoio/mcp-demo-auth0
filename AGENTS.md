<!-- kerno instructions start -->
## Kerno usage

Use Kerno after changes that may affect endpoint behavior. It tests the running API against executable endpoint
scenarios to catch regressions that source checks can miss.

Validate affected endpoints before considering the work complete. If an endpoint has no Kerno coverage, ask whether to
add it; creating initial coverage can take time.

Follow Kerno's MCP tool descriptions for the current workflow and parameters. For asynchronous work, read progress
through Kerno's state tools rather than tailing logs.

## Flow demo prompts

This repository already has calibration and saved owner flows. The prompts in the README's Prompts section are the
demo. Answer them from those flows. Endpoint coverage waits until the user asks about an endpoint.

When they ask to see the saved user flows, read the MCP resource `kerno://workspaces/{workspaceId}/flows` when the
Kerno tools are connected, and otherwise read each `flow.json` under `.kerno/scenarios/flows`. Present every id,
description, and outcome. Stop there.

When they ask to validate those flows, pass every saved `flow_id` to `kerno_validate`. Follow that tool's
description for the argument shape. Present the run with the Kerno presenting-results skill, including each
`portal_run_url`. A pass is no diff from the baseline. A named journey (freezing a card as Ada North, and the cash,
transfer, expense, invoice, and card-limit variants) validates that one flow only.

When they ask to reject a valid owner access token and then validate, reject every bearer in
`createBearerAuthenticator` in `src/auth/verify.ts`, then `docker compose up --build` so the running app serves
that change. Leave the Postgres volume and `.kerno/.env` as they are. Validate the same flows and lead with the
auth diff. When they ask to accept owner access tokens again, restore `src/auth/verify.ts`, rebuild the same way,
and validate once more so the flows return to no diff.
<!-- kerno instructions end -->
