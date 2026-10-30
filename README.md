# Northwharf

Northwharf is a small-business account for one company, exposed as a [Streamable HTTP MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) server. It keeps multi-currency balances, a ledger, team debit cards, expenses, and supplier invoices. Amounts are integer minor units (pence or cents).

A local Auth0 issuer signs members in. The seeded owner is Ada North, `ada.north@northwharf.example` / `ada-north-local`.

This repository is a public demo of that server, and of pointing [Kerno](https://www.kerno.io) at an authenticated MCP API. Kerno is already set up here. It can run the journeys an owner takes: read the cash position, move money between accounts, record an expense, pay a supplier invoice, change a card limit, and freeze a debit card.

Details for running the server by hand, without Docker, or against a real Auth0 tenant are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Run Northwharf

Docker with Compose is required.

```bash
docker compose up --build
```

The app listens on port 8080 after Postgres and the Auth0 issuer are healthy. Startup applies the SQL migrations and loads the seed. Host ports default to 5432 (Postgres), 3000 (Auth0), and 8080 (the app). If one of those is taken, set the matching variable for that command:

```bash
AUTH0_HOST_PORT=3011 POSTGRES_HOST_PORT=5433 docker compose up --build
```

- Health: `http://localhost:8080/health`
- MCP: `http://localhost:8080/mcp`
- Sign up: `http://localhost:3000/signup`
- Sign in: `http://localhost:3000/login`

`docker compose down` stops the stack. Add `-v` when the next start should load the seed again. The Postgres volume keeps the ledger between restarts, and the seed does not overwrite an organization that is already there.

## Run it with Kerno

Kerno is already configured for this repository. With Northwharf running:

1. Install the CLI and sign in. Node.js 18 or newer is required. The full walkthrough is the [Kerno quickstart](https://kerno.gitbook.io/docs/getting-started/quickstart).

   ```bash
   npm install -g @kerno/cli
   kerno login
   ```

   `kerno login` opens a browser. On a machine with no browser, use `kerno login --api-key` or set `KERNO_API_KEY`.

2. Point Kerno at this checkout.

   ```bash
   kerno init -w "/absolute/path/to/mcp-demo-auth0"
   ```

3. Copy [`.kerno/.env.example`](.kerno/.env.example) to `.kerno/.env` and replace `<token>` with an access token. That file is not committed. The password grant in [CONTRIBUTING.md](CONTRIBUTING.md) mints it. It expires after one hour.

4. Connect the MCP server with the snippet `kerno init` prints, in Cursor, Claude Code, or Codex. Start a new chat so the tools load.

5. Ask a question, for example:

   > Freeze a debit card, then read it back as frozen.

   You can ask the same way to read the cash position, move money between two accounts of the same currency, record an expense and see it in the list, pay a supplier invoice and read it back as paid, or change a debit card limit and read the card back.

## Set up a similar repository

The prompt below is for another repository like this one: a Node.js MCP server backed by Postgres and Auth0, where Kerno is not set up yet. Open that repository in your coding agent and paste the prompt there. The same text is in [`KERNO_ONBOARD.md`](KERNO_ONBOARD.md).

```text
Set up Kerno for this repo and map its user flows. This repo is a Node.js MCP server (Streamable HTTP) backed by Postgres and Auth0. Discover every URL, port, client, audience, grant, user, and seed command from this repository. Do not reuse values from any other project, even one on the same stack.

Follow the Kerno MCP's instructions throughout. Read rather than improvise. kerno init prints what you need, and once MCP is live every Kerno tool carries a What/When description saying what to call next. Bundled skills are resources under skill:// (for example skill://kerno-calibrate/SKILL.md). Read each skill named below before that phase and follow it. If a skill or a tool description disagrees with this prompt, the skill or the tool wins. If kerno init prints something different from the commands below, its output wins.

Do not run kerno_flow_test, kerno_endpoint_test, kerno_endpoint_test_many, or kerno_validate. Do not ask testing-intent questions (effort, box strategy, tags). Those belong to a later request. This session ends when the flows are saved.

Prerequisites that must already exist. If any of these is missing, stop and tell me: Node.js 18+, npm, Docker or Podman running, and a git repo.

  npm install -g @kerno/cli
  kerno login
  kerno init -w "<absolute path to this repo>"

Don't run kerno login yourself. It renders an interactive terminal UI and fails in an agent shell with "Raw mode is not supported on the current process.stdin". Tell me to run ! kerno login in the prompt myself, then pause and wait for me to confirm I've logged in before continuing. If I'm working over SSH or in a container with no browser, tell me I can log in with kerno login --api-key instead, or by setting KERNO_API_KEY.

Run kerno init -w even if something seems to be listening already, never two at once, then use the workspace, port and registration snippet it prints verbatim. The port can change when its usual one is taken, so never reuse one from docs, an old config, or memory. In an agent shell, kerno init prints the port and registration snippet as plain text. If they are missing, read the port from ~/.kerno/mcp.port and build the endpoint as http://localhost:N/mcp. kerno doctor --clean fixes an orphan or inconsistent agent.

If kerno init says no organization has been chosen, stop and ask me which organization to use, then re-run kerno init -w "<path>" --org <name or id>. If it says my API key is for a different organization, show me its message and wait for me to sign in again as it describes. Never edit ~/.kerno/state.json by hand.

Register with the host you are running in, and ask whether I want a different one. Register at one scope only, project or user, and merge rather than overwrite other servers. Then allowlist Kerno before calling any tool. A single task runs many calls, including repeated status and job polling, so without this I am clicking approve every few seconds. Explain that to me, show me the change, and apply it once I accept. If it's already present, tell me and move on. Claude Code: "mcp__kerno__*" in permissions.allow in .claude/settings.json or ~/.claude/settings.json. Codex: default_tools_approval_mode = "approve" under [mcp_servers.kerno] in ~/.codex/config.toml. Cursor: no file, tell me to set Run Mode to Auto-review.

Registering the server does not load its tools into a session that was already running. Before you try to call anything, expect the kerno_* tools to be absent, and tell me to reconnect: in Claude Code run /mcp, select the server, and reconnect, or restart the tool. A "Connected" line from claude mcp list is not proof your current session can call the tools, because that check opens its own session.

Verify with kerno_get_applications; that succeeding means connected. Pass this repo's absolute path as workspace_path on every Kerno call.

If Kerno stops, restarts or switches workspace, take the endpoint from kerno init's output and reconnect with it if the kerno_* tools are gone from your session.

Once connected, let Kerno finish analyzing the workspace. The first analysis can run for several minutes and outlast a single tool call, which looks like a hang but isn't. Calling again with the same arguments is safe and picks up the same run. Don't sync the workspace or clear the cache to unstick it, because that restarts the analysis from scratch.

Then list the apps it found and present them to me so I can choose which one to test. If there is more than one, mark which one looks like the MCP server, and once I pick, name that one app in every later Kerno call. Calls without an app analyze every app in the repo, and each app gets its own sandbox container. Stop and wait for me to pick. Do not start the app or save config before I pick.

After I pick, and before any save, read these skills and follow them:

- skill://kerno-usage/SKILL.md — add its Kerno usage section to this repo's agent instruction files. You write it; Kerno does not. Keep the <!-- kerno instructions start --> and <!-- kerno instructions end --> comments. Skip a file that already has the heading. If none of those files exist, create only AGENTS.md. Do not put credentials in those files.
- skill://kerno-reviewing-lessons/SKILL.md — after analysis, call kerno_lessons_pending and send every verdict in one kerno_review_lessons call. Reviewing does not block the rest of this session. An analysis facet that is right about the subject and wrong about the grant, the issuer, or the token recipe gets amend, not disagree. Leave reviewed_by null unless I gave that verdict myself.

Environment, then config. Read skill://kerno-env-visibility/SKILL.md before the first kerno_save_config, and follow kerno_environment_setup and kerno_environment_status for how to bring the system under test up. Choose target_environment before setup. For local: start this repo's own dependencies and app the way its README, compose file, or package scripts say, verify a real HTTP response from the MCP endpoint, then save that URL as sut_url. Prefer datastore mode: sut_url plus the dependency env blocks for the same Postgres and Auth0 the running app uses. Do not wipe volumes or reset data unless I ask.

Kerno sees only the workspace snapshot, what you pass to kerno_save_config, and .kerno/.env. A shell export or a .env elsewhere is invisible. kerno_save_config writes .kerno/config.yaml, which is committed. A real secret goes only in .kerno/.env. Declare the variable's name in the matching env block with an empty value. A save that carries a credential is rejected. A password, a client secret, an API key, a bearer token, and any URL or connection string that contains one are secrets. Hosts, ports, audience, issuer URL, JWKS URL, client id, and a test username are not.

Stack constraints for this repo:

- The system under test is the MCP endpoint. Save that URL as sut_url before any authenticated call. Kerno sends MCP_AUTH_HEADERS only to that host and port.
- MCP_AUTH_HEADERS is a JSON object of header name to value, shaped {"Authorization":"Bearer <token>"}. Write it only in .kerno/.env. Never declare it in kerno_save_config. The server requires it on every request, including initialize.
- The app verifies access tokens. It does not issue them. Mint during arrange, against the issuer this repo configures.
- Find the grant by one live request to the running issuer. Keep a documented client-credentials flow only if a token from that grant is accepted as a member. A signed token with no user subject is a common cause of 403 on an otherwise valid token.
- If this repo depends on an Auth0 authentication SDK, mint with that SDK's password or resource-owner method, the same way the repo's own scripts do. Leave a hand-built call to the token endpoint, and any helper that signs a JWT locally, unused.
- AUTH0_DOMAIN is the hostname and port, with no scheme.
- Auth0 SDKs build https URLs. When this issuer is plain HTTP, pass a custom fetch that rewrites https://AUTH0_DOMAIN to http://AUTH0_DOMAIN before the request is sent. That rewrite is part of the working recipe. Do not report it as blocked.
- Put the issuer in the infrastructure inventory as its own component, access direct when you may call it. Non-secret issuer settings go in that env block. Secret names go there as empty strings, with the values in .kerno/.env.
- Postgres is a direct dependency when the app talks to it. Scenarios must use the same database as the running app. DATABASE_URL is a secret: empty in the postgres env block, full value in .kerno/.env. Seed with the app's own seed command, not with SQL you invent.
- Access tokens expire. On 401, mint a new token, replace MCP_AUTH_HEADERS, and retry once before treating the call as a product failure. 401 means the credential is missing or invalid. 403 means the subject is not a member. A member missing a tool permission is an MCP tool error, not an HTTP 500.

Record every infrastructure component the code talks to, including any you must not touch (access none, with a reason). Then follow the tool's healthcheck: review the generated .kerno/healthcheck file, and confirm kerno_environment_status is healthy. When you need a fresh check, call it with refresh_health rather than waiting for the next interval. A result older than a fix you just made says nothing about the fix.

Calibrate once the system under test is healthy and config is saved. Skip this phase only when .kerno/config.yaml already holds a calibration record. Read skill://kerno-calibrate/SKILL.md and follow it step for step, including the save that marks calibration in_progress before you read any file, and the save that marks needs_user_feedback before you ask me anything.

The skill's confirmation rule overrides this prompt: reveal exactly one calibration target per message, then stop and wait for my answer before mentioning the next. Use the host's structured question tool when you have one. Do not pre-announce how many targets there are or list the ones still to come. Skip tenancy only when this repo is single-tenant, and record that target as skipped. Never skip the infrastructure inventory. Write only verified facts into test-generation context. Close with calibration status calibrated and a one-line note. If I decline, record declined with my reason and still continue to flows.

Map flows as soon as calibration is recorded (calibrated or declined). Read skill://kerno-choosing-a-user-flow/SKILL.md. Before mapping, read the MCP resource kerno://workspaces/{workspaceId}/flows and follow its next_action. When flows are already recorded, show their ids and ask which one I want, or whether to add more. When none are recorded:

- Ask me which three to five things people do with this product matter most. You may offer candidates from the README, the main entities, and the write operations, but save a journey only after I confirm it in my own words. Keep my sentence as the flow description.
- Pin the actor before the steps, using the credential calibration established. Every step must be performable by that one actor. A journey that changes privilege is two flows.
- Shortest sequence that reaches the outcome. The outcome is a business fact, not a status code. The last step reads that outcome back. Mark setup steps as setup.
- Save them all in one kerno_save_flows call. On rejection, fix the named endpoint and save again with the same flow_id. Show me each saved id and any portal URL the tool returns.

Probing the deepest step is required before kerno_flow_test, not before saving the map. Do not probe and do not launch a flow test in this session.

Stop there. Tell me the chosen app, that calibration is recorded, and the flow ids you saved. Wait for me to ask before running anything.
```
