import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { accessPermissions, ownerSubject } from "../src/auth/permissions.js";

const appUrl = process.env.NORTHWHARF_URL ?? "http://127.0.0.1:8080";
const authUrl = process.env.AUTH0_PUBLIC_URL ?? "http://127.0.0.1:3000";
const audience = process.env.AUTH0_AUDIENCE ?? "https://mcp.northwharf.local";
const issuer = process.env.AUTH0_ISSUER ?? "https://auth.northwharf.local/";
const clientId = process.env.AUTH0_CLIENT_ID ?? "client_id";
const clientSecret = process.env.AUTH0_CLIENT_SECRET ?? "client_secret";

await main();

async function main(): Promise<void> {
  await waitForHealth();
  const token = await mintToken(audience);
  const claims = decodePayload(token);
  if (claims.iss !== issuer) {
    throw new Error(`issuer claim is ${String(claims.iss)}, expected ${issuer}`);
  }
  if (claims.aud !== audience) {
    throw new Error(`audience claim is ${String(claims.aud)}, expected ${audience}`);
  }
  if (claims.sub !== ownerSubject) {
    throw new Error(`subject claim is ${String(claims.sub)}, expected ${ownerSubject}`);
  }
  console.log(`token ok iss=${String(claims.iss)} sub=${String(claims.sub)}`);

  const client = await connect(token);
  try {
    const who = await callJson(client, "whoami", {});
    if (who.member === undefined || !JSON.stringify(who).includes("Ada North")) {
      throw new Error(`whoami did not return Ada North: ${JSON.stringify(who)}`);
    }
    const accounts = await callJson(client, "list_accounts", {});
    if (!JSON.stringify(accounts).includes("Operating GBP")) {
      throw new Error(`list_accounts missing Operating GBP: ${JSON.stringify(accounts)}`);
    }
    const snapshot = await callJson(client, "cash_snapshot", {});
    if (!JSON.stringify(snapshot).includes("runwayMonths")) {
      throw new Error(`cash_snapshot missing runway: ${JSON.stringify(snapshot)}`);
    }
    console.log("whoami, list_accounts, cash_snapshot ok");
    await callAccountsOverHttp(token);
    console.log("HTTP tools/call list_accounts ok");
  } finally {
    await client.close();
  }

  await expectMissingToken();
  console.log("missing token rejected");
  await expectMissingPermission();
  console.log("missing permission rejected");
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

async function mintToken(tokenAudience: string): Promise<string> {
  const response = await fetch(`${authUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience: tokenAudience,
      grant_type: "client_credentials",
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string") {
    throw new Error(`token request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
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
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${name} did not return an object`);
  }
  return parsed;
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

async function expectMissingPermission(): Promise<void> {
  try {
    await setPermissions(["cards:read"]);
    const token = await mintToken(audience);
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
  } finally {
    await setPermissions([...accessPermissions]);
  }
}

async function setPermissions(permissions: readonly string[]): Promise<void> {
  const response = await fetch(`${authUrl}/permissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience, permissions }),
  });
  if (!response.ok) {
    throw new Error(`permission update failed ${response.status}: ${await response.text()}`);
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
  return typeof value === "object" && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
