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

describe("Auth0 management stand-in", { concurrency: 1 }, () => {
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

  it("rejects a management token request that omits the secret", async () => {
    const response = await post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: config.clientId,
      audience: config.managementAudience,
    });
    assert.equal(response.status, 401);
    assert.equal(asRecord(await response.json()).error, "access_denied");
  });

  it("rejects a management token request with the wrong secret", async () => {
    const response = await post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: "not-the-secret",
      audience: config.managementAudience,
    });
    assert.equal(response.status, 401);
  });

  it("returns a management token for the management audience", async () => {
    const token = await managementToken();
    const claims = payloadOf(token);
    assert.equal(claims.aud, config.managementAudience);
    assert.equal(claims.iss, config.issuer);
    const probe = await fetch(`${probeUrl}/probe`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(probe.status, 401);
  });

  it("signs the seeded owner in without provisioning another member", async () => {
    const beforeCount = provisioned.length;
    const token = await passwordToken(config.ownerEmail, config.ownerPassword);
    assert.equal(payloadOf(token).sub, ownerSubject);
    const probe = await acceptedProbe(token);
    assert.equal(probe.subject, ownerSubject);
    assert.ok(probe.permissions.includes("accounts:read"));
    assert.equal(provisioned.length, beforeCount);
  });

  it("creates a user and accepts that user's access token", async () => {
    const token = await managementToken();
    const response = await post(
      "/api/v2/users",
      {
        email: "casey.shore@northwharf.example",
        password: "shore-local-pass",
        connection: "Username-Password-Authentication",
        email_verified: true,
        name: "Casey Shore",
      },
      token,
    );
    assert.equal(response.status, 201);
    const created = asRecord(await response.json());
    const userId = created.user_id;
    assert.equal(typeof userId, "string");
    assert.match(String(userId), /^auth0\|[0-9a-f]{24}$/);
    assert.notEqual(userId, ownerSubject);
    assert.deepEqual(
      provisioned.filter((member) => member.email === "casey.shore@northwharf.example"),
      [{ subject: userId, email: "casey.shore@northwharf.example", displayName: "Casey Shore" }],
    );

    const userToken = await passwordToken("casey.shore@northwharf.example", "shore-local-pass");
    assert.equal(payloadOf(userToken).sub, userId);
    const probe = await acceptedProbe(userToken);
    assert.equal(probe.subject, userId);
    assert.ok(probe.permissions.includes("accounts:read"));
    assert.ok(probe.permissions.includes("transfers:write"));

    const denied = await post(
      "/api/v2/users",
      {
        email: "other.shore@northwharf.example",
        password: "shore-local-pass",
        connection: "Username-Password-Authentication",
      },
      userToken,
    );
    assert.equal(denied.status, 401);
  });

  it("rejects a second user with the same email", async () => {
    const response = await post(
      "/api/v2/users",
      {
        email: "Casey.Shore@northwharf.example",
        password: "shore-local-pass",
        connection: "Username-Password-Authentication",
      },
      await managementToken(),
    );
    assert.equal(response.status, 409);
  });

  it("puts app_metadata permissions on that user's access token", async () => {
    const response = await post(
      "/api/v2/users",
      {
        email: "limited.shore@northwharf.example",
        password: "shore-local-pass",
        connection: "Username-Password-Authentication",
        name: "Limited Shore",
        app_metadata: { permissions: ["cards:read"] },
      },
      await managementToken(),
    );
    assert.equal(response.status, 201);
    const userToken = await passwordToken("limited.shore@northwharf.example", "shore-local-pass");
    const probe = await acceptedProbe(userToken);
    assert.deepEqual(probe.permissions, ["cards:read"]);
  });

  it("rejects user creation without a management token", async () => {
    const response = await post("/api/v2/users", {
      email: "nobody.shore@northwharf.example",
      password: "shore-local-pass",
      connection: "Username-Password-Authentication",
    });
    assert.equal(response.status, 401);
  });

  async function post(path: string, body: unknown, bearer?: string): Promise<Response> {
    return fetch(`${identityUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function managementToken(): Promise<string> {
    const response = await post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: config.managementAudience,
    });
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(typeof body.access_token, "string");
    return body.access_token as string;
  }

  async function passwordToken(username: string, password: string): Promise<string> {
    const response = await post("/oauth/token", {
      grant_type: "password",
      username,
      password,
      audience: config.apiAudience,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(typeof body.access_token, "string");
    return body.access_token as string;
  }

  async function acceptedProbe(token: string): Promise<{ subject: string; permissions: string[] }> {
    const response = await fetch(`${probeUrl}/probe`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = asRecord(await response.json());
    assert.equal(typeof body.subject, "string");
    assert.ok(Array.isArray(body.permissions));
    assert.ok(body.permissions.every((item) => typeof item === "string"));
    return { subject: body.subject as string, permissions: body.permissions as string[] };
  }
});

function payloadOf(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  assert.ok(part);
  return asRecord(JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
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
