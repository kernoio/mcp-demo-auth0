import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createAuth0Client } from "../src/auth/auth0.js";
import { ownerSubject } from "../src/auth/permissions.js";

const appUrl = process.env.NORTHWHARF_URL ?? "http://127.0.0.1:8080";
const authUrl = process.env.AUTH0_PUBLIC_URL ?? "http://127.0.0.1:3000";
const audience = process.env.AUTH0_AUDIENCE ?? "http://localhost:8080/mcp";
const issuer = process.env.AUTH0_ISSUER ?? process.env.AUTH0_ISSUER_BASE_URL ?? "http://localhost:3000";
const clientId = process.env.AUTH0_MGMT_CLIENT_ID ?? "northwharf-management";
const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET ?? "northwharf-management-secret";
const ownerEmail = process.env.AUTH0_OWNER_EMAIL ?? "ada.north@northwharf.example";
const ownerPassword = process.env.AUTH0_OWNER_PASSWORD ?? "ada-north-local";
const auth0 = createAuth0Client({
  issuer,
  baseUrl: authUrl,
  clientId,
  clientSecret,
  audience,
});

await main();

async function main(): Promise<void> {
  await waitForHealth();
  await auth0.rejectIncorrectManagementSecret();
  const stamp = Date.now().toString(36);

  const ownerToken = await auth0.passwordGrant(ownerEmail, ownerPassword);
  const ownerClaims = decodePayload(ownerToken);
  if (ownerClaims.iss !== issuer || ownerClaims.aud !== audience || ownerClaims.sub !== ownerSubject) {
    throw new Error(`owner token claims ${JSON.stringify(ownerClaims)}`);
  }
  if (ownerClaims.gty !== "password") {
    throw new Error(`owner grant is ${String(ownerClaims.gty)}`);
  }
  console.log(`owner token ok sub=${String(ownerClaims.sub)}`);

  const ownerClient = await connect(ownerToken);
  try {
    const who = await callJson(ownerClient, "whoami", {});
    if (who.subject !== ownerSubject || !JSON.stringify(who).includes("Ada North")) {
      throw new Error(`whoami did not return Ada North: ${JSON.stringify(who)}`);
    }
    const accounts = await callJson(ownerClient, "list_accounts", {});
    if (!JSON.stringify(accounts).includes("Operating GBP")) {
      throw new Error(`list_accounts missing Operating GBP: ${JSON.stringify(accounts)}`);
    }
    console.log("owner whoami and list_accounts ok");
  } finally {
    await ownerClient.close();
  }

  const createdEmail = `casey.${stamp}@northwharf.example`;
  const created = await auth0.createUser({
    email: createdEmail,
    password: "shore-local-pass",
    emailVerified: true,
    name: "Casey Shore",
  });
  if (created.userId === ownerSubject || !created.userId.startsWith("auth0|")) {
    throw new Error(`created user id ${created.userId}`);
  }
  const createdToken = await auth0.passwordGrant(createdEmail, "shore-local-pass");
  if (decodePayload(createdToken).sub !== created.userId) {
    throw new Error("created user token subject does not match user_id");
  }
  const createdClient = await connect(createdToken);
  try {
    const who = await callJson(createdClient, "whoami", {});
    if (who.subject !== created.userId) {
      throw new Error(`created whoami subject ${String(who.subject)}`);
    }
    const accounts = await callJson(createdClient, "list_accounts", {});
    if (!JSON.stringify(accounts).includes("Operating GBP")) {
      throw new Error(`created user list_accounts missing Operating GBP: ${JSON.stringify(accounts)}`);
    }
    console.log(`created user ok sub=${created.userId}`);
  } finally {
    await createdClient.close();
  }
  await callAccountsOverHttp(createdToken);

  await expectMissingPermission(`limited.${stamp}@northwharf.example`);
  await expectMissingToken();
  console.log("smoke ok");
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let last = "not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/health`);
      if (response.ok) {
        return;
      }
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed";
    }
    await delay(1000);
  }
  throw new Error(`Northwharf health check did not pass: ${last}`);
}

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${appUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "northwharf-smoke", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = toolResult(await client.callTool({ name, arguments: args }));
  const text = textContent(result);
  if (result.isError) {
    throw new Error(`${name} failed: ${text}`);
  }
  return parseObject(text, name);
}

async function callAccountsOverHttp(token: string): Promise<void> {
  const response = await fetch(`${appUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} },
    }),
  });
  const body = await response.text();
  if (response.status !== 200 || !body.includes("Operating GBP")) {
    throw new Error(`list_accounts HTTP ${response.status}: ${body}`);
  }
}

async function expectMissingToken(): Promise<void> {
  const response = await fetch(`${appUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} },
    }),
  });
  if (response.status !== 401) {
    throw new Error(`expected 401 without a token, got ${response.status}: ${await response.text()}`);
  }
}

async function expectMissingPermission(email: string): Promise<void> {
  await auth0.createUser({
    email,
    password: "shore-local-pass",
    name: "Limited Shore",
    permissions: ["cards:read"],
  });
  const token = await auth0.passwordGrant(email, "shore-local-pass");
  const client = await connect(token);
  try {
    const result = toolResult(await client.callTool({ name: "list_accounts", arguments: {} }));
    const text = textContent(result);
    if (!result.isError || !text.includes("accounts:read")) {
      throw new Error(`expected a permission error, got ${text}`);
    }
  } finally {
    await client.close();
  }
}

function toolResult(result: Awaited<ReturnType<Client["callTool"]>>): CallToolResult {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("tool result had no content");
  }
  return result as CallToolResult;
}

function textContent(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("tool result had no text");
  }
  return block.text;
}

function parseObject(text: string, name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${name} did not return an object`);
  }
  return parsed;
}

function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) {
    throw new Error("token has no payload");
  }
  const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("token payload is not an object");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
