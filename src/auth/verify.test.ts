import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { authErrorHandler, createBearerAuthenticator, resolveAccess } from "./verify.js";

const issuer = "https://auth.northwharf.local/";
const audience = "https://mcp.northwharf.local";
const knownSubject = "auth0|6728f0a1b2c3d4e5f6789012";

describe("Auth0 access verifier", () => {
  let jwksServer: Server;
  let appServer: Server;
  let baseUrl = "";
  let signingKey: KeyObject;
  let otherKey: KeyObject;
  const kid = "northwharf-test";

  before(async () => {
    const primary = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    signingKey = primary.privateKey;
    otherKey = other.privateKey;
    const jwk = publishedJwk(primary.publicKey, kid);

    jwksServer = createServer((req, res) => {
      if (req.url?.startsWith("/.well-known/jwks.json")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const jwksPort = await listen(jwksServer);

    const app = express();
    app.disable("x-powered-by");
    const authenticate = createBearerAuthenticator({
      authIssuer: issuer,
      authAudience: audience,
      authJwksUrl: `http://127.0.0.1:${jwksPort}/.well-known/jwks.json`,
    });
    app.get("/probe", authenticate, (req, res, next) => {
      void resolveAccess(req, async (subject) => subject === knownSubject)
        .then((access) => {
          res.status(200).json(access);
        })
        .catch(next);
    });
    app.use(authErrorHandler);
    appServer = createServer(app);
    const appPort = await listen(appServer);
    baseUrl = `http://127.0.0.1:${appPort}`;
  });

  after(async () => {
    await close(appServer);
    await close(jwksServer);
  });

  it("accepts a token signed by the local JWKS for a known user", async () => {
    const token = signToken(signingKey, kid, claims({ sub: knownSubject, permissions: ["accounts:read"] }));
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    assert.deepEqual(body, { subject: knownSubject, permissions: ["accounts:read"] });
  });

  it("rejects a request with no token", async () => {
    const response = await fetch(`${baseUrl}/probe`);
    assert.equal(response.status, 401);
    const body = await readError(response);
    assert.equal(body.error, "unauthenticated");
  });

  it("rejects a token with a bad signature", async () => {
    const token = signToken(otherKey, kid, claims({ sub: knownSubject }));
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    const body = await readError(response);
    assert.equal(body.error, "unauthenticated");
  });

  it("rejects a token with the wrong audience", async () => {
    const token = signToken(signingKey, kid, claims({ sub: knownSubject, aud: "https://other.example" }));
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    const body = await readError(response);
    assert.equal(body.error, "unauthenticated");
  });

  it("rejects a token whose subject is not a member", async () => {
    const token = signToken(signingKey, kid, claims({ sub: "auth0|not-a-member" }));
    const response = await fetch(`${baseUrl}/probe`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 403);
    const body = await readError(response);
    assert.equal(body.error, "forbidden");
    assert.match(body.message, /member/);
  });
});

function claims(overrides: { sub: string; aud?: string; permissions?: readonly string[] }): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    sub: overrides.sub,
    aud: overrides.aud ?? audience,
    iat: now,
    nbf: now,
    exp: now + 600,
    permissions: overrides.permissions ?? ["accounts:read"],
  };
}

function signToken(key: KeyObject, kid: string, payload: Record<string, unknown>): string {
  const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), key);
  return `${input}.${base64url(signature)}`;
}

function publishedJwk(publicKey: KeyObject, kid: string): JsonWebKey & { kid: string; alg: string; use: string } {
  const jwk = publicKey.export({ format: "jwk" });
  return { ...jwk, kid, alg: "RS256", use: "sig" };
}

function base64url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer.toString("base64url");
}

async function readError(response: Response): Promise<{ error: string; message: string }> {
  const body: unknown = await response.json();
  assert.ok(body && typeof body === "object");
  const record = body as Record<string, unknown>;
  assert.equal(typeof record.error, "string");
  assert.equal(typeof record.message, "string");
  return { error: record.error as string, message: record.message as string };
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
