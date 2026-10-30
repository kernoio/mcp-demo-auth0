import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createIdentityApp } from "../identity/app.js";
import { managementAudienceFor, type IdentityConfig } from "../identity/config.js";
import { createSigningKeys } from "../identity/tokens.js";
import { createAuth0Client, type Auth0Client } from "./auth0.js";
import { ownerSubject } from "./permissions.js";

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

describe("Auth0 SDK client", { concurrency: 1 }, () => {
  let server: Server;
  let auth: Auth0Client;

  before(async () => {
    const app = createIdentityApp({
      config,
      keys: createSigningKeys(),
      provisionMember: async () => undefined,
    });
    server = createServer(app);
    const port = await listen(server);
    auth = createAuth0Client({
      issuer: config.issuer,
      baseUrl: `http://127.0.0.1:${port}`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      audience: config.apiAudience,
    });
  });

  after(async () => {
    await close(server);
  });

  it("rejects a management token request with the wrong secret", async () => {
    await auth.rejectIncorrectManagementSecret();
  });

  it("signs in the seeded owner with the password grant", async () => {
    const token = await auth.passwordGrant(config.ownerEmail, config.ownerPassword);
    const claims = payloadOf(token);
    assert.equal(claims.sub, ownerSubject);
    assert.equal(claims.iss, config.issuer);
    assert.equal(claims.aud, config.apiAudience);
    assert.equal(claims.gty, "password");
  });

  it("creates a user and signs that user in", async () => {
    const created = await auth.createUser({
      email: "casey.sdk@northwharf.example",
      password: "shore-local-pass",
      name: "Casey Shore",
      emailVerified: true,
      permissions: ["cards:read"],
    });
    assert.match(created.userId, /^auth0\|[0-9a-f]{24}$/);
    assert.notEqual(created.userId, ownerSubject);
    const token = await auth.passwordGrant("casey.sdk@northwharf.example", "shore-local-pass");
    const claims = payloadOf(token);
    assert.equal(claims.sub, created.userId);
    assert.deepEqual(claims.permissions, ["cards:read"]);
  });
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
