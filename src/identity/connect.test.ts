import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ownerSubject } from "../auth/permissions.js";
import { authErrorHandler, createBearerAuthenticator, resolveAccess } from "../auth/verify.js";
import { createIdentityApp, type MemberProvision } from "./app.js";
import { managementAudienceFor, type IdentityConfig } from "./config.js";
import { createSigningKeys } from "./tokens.js";

const issuer = "https://auth.northwharf.local/";
const redirectUri = "http://127.0.0.1:9876/callback";
const config: IdentityConfig = {
  issuer,
  apiAudience: "https://mcp.northwharf.local",
  managementAudience: managementAudienceFor(issuer),
  clientId: "northwharf-management",
  clientSecret: "northwharf-management-secret",
  ownerSubject,
  ownerEmail: "ada.north@northwharf.example",
  ownerName: "Ada North",
  ownerPassword: "ada-north-local",
};

describe("MCP authorization flow", { concurrency: 1 }, () => {
  let identityServer: Server;
  let probeServer: Server;
  let identityUrl = "";
  let probeUrl = "";
  const provisioned: MemberProvision[] = [];

  before(async () => {
    const app = createIdentityApp({
      config,
      keys: createSigningKeys(),
      provisionMember: async (member) => {
        provisioned.push(member);
      },
    });
    identityServer = createServer(app);
    identityUrl = `http://127.0.0.1:${await listen(identityServer)}`;

    const probe = express();
    probe.disable("x-powered-by");
    const authenticate = createBearerAuthenticator({
      authIssuer: config.issuer,
      authAudience: config.apiAudience,
      authJwksUrl: `${identityUrl}/.well-known/jwks.json`,
    });
    probe.get("/probe", authenticate, (req, res, next) => {
      void resolveAccess(req, async () => true)
        .then((access) => {
          res.status(200).json(access);
        })
        .catch(next);
    });
    probe.use(authErrorHandler);
    probeServer = createServer(probe);
    probeUrl = `http://127.0.0.1:${await listen(probeServer)}`;
  });

  after(async () => {
    await close(probeServer);
    await close(identityServer);
  });

  it("advertises the authorization server and protected resource flow", async () => {
    const response = await fetch(`${identityUrl}/.well-known/oauth-authorization-server`);
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(body.issuer, config.issuer);
    assert.equal(body.authorization_endpoint, "https://auth.northwharf.local/authorize");
    assert.equal(body.token_endpoint, "https://auth.northwharf.local/oauth/token");
    assert.equal(body.registration_endpoint, "https://auth.northwharf.local/oauth/register");
    assert.deepEqual(body.code_challenge_methods_supported, ["S256"]);
    assert.ok(Array.isArray(body.scopes_supported));
    assert.ok((body.scopes_supported as string[]).includes("accounts:read"));
  });

  it("registers a public client and rejects a non-loopback redirect", async () => {
    const client = await register("Ledger desk", [redirectUri]);
    assert.equal(typeof client.client_id, "string");
    assert.deepEqual(client.redirect_uris, [redirectUri]);
    assert.equal(client.token_endpoint_auth_method, "none");

    const cursor = await register("Cursor", [
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "https://www.cursor.com/agents/mcp/oauth/callback",
      "http://localhost:8787/callback",
    ]);
    assert.equal((cursor.redirect_uris as string[]).length, 3);

    const rejected = await fetch(`${identityUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Elsewhere",
        redirect_uris: ["https://evil.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(asRecord(await rejected.json()).error, "invalid_redirect_uri");
  });

  it("signs up a user, shows them signed in, and approves the connection", async () => {
    const client = await register("Ledger desk", [redirectUri]);
    const clientId = String(client.client_id);
    const jar = createJar(identityUrl);
    const { verifier, challenge } = pkce();
    const state = "signup-state";

    const started = await jar.fetch(authorizePath(clientId, challenge, state, "accounts:read treasury:read"));
    assert.equal(started.status, 302);
    const login = location(started, identityUrl);
    assert.equal(login.pathname, "/login");
    const requestId = login.searchParams.get("request");
    assert.ok(requestId);

    const created = await jar.fetch("/signup", {
      method: "POST",
      body: new URLSearchParams({
        request: requestId,
        name: "Casey Shore",
        email: "casey.flow@northwharf.example",
        password: "shore-local-pass",
      }),
    });
    assert.equal(created.status, 302);
    assert.equal(location(created, identityUrl).pathname, "/consent");
    assert.deepEqual(
      provisioned.filter((member) => member.email === "casey.flow@northwharf.example"),
      [{
        subject: provisioned.find((member) => member.email === "casey.flow@northwharf.example")?.subject,
        email: "casey.flow@northwharf.example",
        displayName: "Casey Shore",
      }],
    );

    const consent = await jar.fetch(location(created, identityUrl).pathname + location(created, identityUrl).search);
    assert.equal(consent.status, 200);
    const html = await consent.text();
    assert.match(html, /Casey Shore/);
    assert.match(html, /casey\.flow@northwharf\.example/);
    assert.match(html, /Ledger desk/);
    assert.match(html, /Allow connection/);
    assert.match(html, /See accounts and transactions/);
    assert.match(html, /See the cash position/);
    assert.doesNotMatch(html, /Move money between accounts/);

    const approved = await jar.fetch("/consent", {
      method: "POST",
      body: new URLSearchParams({
        request: field(html, "request"),
        csrf: field(html, "csrf"),
        decision: "approve",
      }),
    });
    assert.equal(approved.status, 302);
    const callback = location(approved, identityUrl);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), state);
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const token = await exchange(clientId, code, verifier);
    const probe = await acceptedProbe(token.access_token);
    assert.equal(probe.subject, provisioned.find((member) => member.email === "casey.flow@northwharf.example")?.subject);
    assert.deepEqual(probe.permissions, ["accounts:read", "treasury:read"]);

    const replay = await fetch(`${identityUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: config.apiAudience,
      }),
    });
    assert.equal(replay.status, 400);

    const refreshed = await fetch(`${identityUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: token.refresh_token,
        resource: config.apiAudience,
      }),
    });
    assert.equal(refreshed.status, 200);
    const next = asRecord(await refreshed.json());
    assert.equal(typeof next.access_token, "string");
    assert.notEqual(next.refresh_token, token.refresh_token);
    const again = await acceptedProbe(String(next.access_token));
    assert.deepEqual(again.permissions, ["accounts:read", "treasury:read"]);

    const home = await jar.fetch("/");
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Signed in/);
    assert.match(homeHtml, /auth0\|/);
  });

  it("rejects a wrong password, then signs that user in and denies consent", async () => {
    const client = await register("Ledger desk", [redirectUri]);
    const clientId = String(client.client_id);
    const jar = createJar(identityUrl);
    await jar.fetch("/signup", {
      method: "POST",
      body: new URLSearchParams({
        name: "Nia Shore",
        email: "nia.flow@northwharf.example",
        password: "shore-local-pass",
      }),
    });
    const signedIn = await jar.fetch("/");
    assert.match(await signedIn.text(), /Nia Shore/);

    await jar.fetch("/logout", { method: "POST", body: new URLSearchParams() });
    const signedOut = await jar.fetch("/");
    assert.match(await signedOut.text(), /Create an account/);

    const wrong = await jar.fetch("/login", {
      method: "POST",
      body: new URLSearchParams({
        email: "nia.flow@northwharf.example",
        password: "not-the-password",
      }),
    });
    assert.equal(wrong.status, 401);
    assert.match(await wrong.text(), /Wrong email or password/);

    const loggedIn = await jar.fetch("/login", {
      method: "POST",
      body: new URLSearchParams({
        email: "nia.flow@northwharf.example",
        password: "shore-local-pass",
      }),
    });
    assert.equal(loggedIn.status, 302);
    assert.equal(location(loggedIn, identityUrl).pathname, "/");

    const duplicate = await createJar(identityUrl).fetch("/signup", {
      method: "POST",
      body: new URLSearchParams({
        name: "Nia Shore",
        email: "nia.flow@northwharf.example",
        password: "shore-local-pass",
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.match(await duplicate.text(), /already exists/);

    const { challenge } = pkce();
    const started = await jar.fetch(authorizePath(clientId, challenge, "deny-state", "accounts:read"));
    assert.equal(started.status, 302);
    const consentUrl = location(started, identityUrl);
    assert.equal(consentUrl.pathname, "/consent");
    const consent = await jar.fetch(consentUrl.pathname + consentUrl.search);
    const html = await consent.text();
    assert.match(html, /Nia Shore/);
    const denied = await jar.fetch("/consent", {
      method: "POST",
      body: new URLSearchParams({
        request: field(html, "request"),
        csrf: field(html, "csrf"),
        decision: "deny",
      }),
    });
    assert.equal(denied.status, 302);
    const callback = location(denied, identityUrl);
    assert.equal(callback.searchParams.get("error"), "access_denied");
    assert.equal(callback.searchParams.get("state"), "deny-state");
    assert.equal(callback.searchParams.get("code"), null);
  });

  async function register(name: string, redirectUris: string[]): Promise<Record<string, unknown>> {
    const response = await fetch(`${identityUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(response.status, 201);
    return asRecord(await response.json());
  }

  async function exchange(
    clientId: string,
    code: string,
    verifier: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const response = await fetch(`${identityUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: config.apiAudience,
      }),
    });
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(typeof body.access_token, "string");
    assert.equal(typeof body.refresh_token, "string");
    return { access_token: String(body.access_token), refresh_token: String(body.refresh_token) };
  }

  async function acceptedProbe(token: string): Promise<{ subject: string; permissions: string[] }> {
    const response = await fetch(`${probeUrl}/probe`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(typeof body.subject, "string");
    assert.ok(Array.isArray(body.permissions));
    return { subject: String(body.subject), permissions: body.permissions as string[] };
  }
});

function authorizePath(clientId: string, challenge: string, state: string, scope: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope,
    resource: config.apiAudience,
  });
  return `/authorize?${params.toString()}`;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function field(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  assert.ok(match?.[1], `missing ${name}`);
  return match[1];
}

function location(response: Response, base: string): URL {
  const header = response.headers.get("location");
  assert.ok(header);
  return new URL(header, base);
}

function createJar(base: string): { fetch(path: string, init?: RequestInit): Promise<Response> } {
  const cookies = new Map<string, string>();
  return {
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (cookies.size > 0) {
        headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
      }
      const response = await fetch(new URL(path, base), { ...init, headers, redirect: "manual" });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0] ?? "";
        const separator = pair.indexOf("=");
        if (separator <= 0) {
          continue;
        }
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (/max-age=0/i.test(line)) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
      return response;
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
        return;
      }
      reject(new Error("server did not bind a port"));
    });
  });
}

function close(server: Server | undefined): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
