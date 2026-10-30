import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createBearerAuthenticator } from "../auth/verify.js";
import type { Database } from "../db/client.js";
import { createApp } from "./app.js";

const resource = "http://127.0.0.1:8080/mcp";
const authorizationServer = "http://127.0.0.1:3000";

describe("MCP discovery", () => {
  let server: Server;
  let baseUrl = "";

  before(async () => {
    const app = createApp({} as Database, createBearerAuthenticator({
      authIssuer: authorizationServer,
      authAudience: resource,
      authJwksUrl: "http://127.0.0.1:9/jwks.json",
    }), { resource, authorizationServer });
    server = createServer(app);
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("publishes protected resource metadata", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.deepEqual(body, {
      resource,
      authorization_servers: [authorizationServer],
      scopes_supported: [
        "accounts:read",
        "transfers:write",
        "expenses:read",
        "expenses:write",
        "invoices:read",
        "invoices:pay",
        "cards:read",
        "cards:manage",
        "treasury:read",
      ],
      bearer_methods_supported: ["header"],
    });
  });

  it("challenges an unauthenticated MCP call with the metadata URL", async () => {
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    assert.equal(response.status, 401);
    const header = response.headers.get("www-authenticate");
    assert.ok(header);
    assert.match(header, /resource_metadata="http:\/\/127\.0\.0\.1:8080\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.match(header, /scope="accounts:read /);
  });
});

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
