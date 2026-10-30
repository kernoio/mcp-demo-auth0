import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Response } from "express";
import { accessPermissions } from "../auth/permissions.js";
import { DomainError } from "../domain/errors.js";
import { RequestError } from "./errors.js";
import type { IdentityConfig } from "./config.js";
import {
  accountPage,
  consentPage,
  loginPage,
  messagePage,
  scopeLabel,
  signedOutPage,
  signupPage,
} from "./pages.js";

const passwordRealmGrant = "http://auth0.com/oauth/grant-type/password-realm";
const sessionCookie = "northwharf_session";
const pendingTtlMs = 10 * 60 * 1000;
const codeTtlMs = 5 * 60 * 1000;
const refreshTtlMs = 14 * 24 * 60 * 60 * 1000;
const sessionTtlMs = 12 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const cursorCallback = "cursor://anysphere.cursor-mcp/oauth/callback";
const cursorCloudCallback = "https://www.cursor.com/agents/mcp/oauth/callback";

export type Account = {
  userId: string;
  email: string;
  name: string;
  permissions: readonly string[];
};

export type AccountDirectory = {
  authenticate(email: string, password: string): Account | undefined;
  create(input: { email: string; password: string; name: string }): Promise<Account>;
  findById(userId: string): Account | undefined;
};

export type RedeemedToken = {
  accessToken: string;
  refreshToken: string;
  scope: string;
};

type ConnectOptions = {
  config: IdentityConfig;
  now: () => Date;
  directory: AccountDirectory;
  signAccessToken(input: { account: Account; scopes: readonly string[]; clientId: string; gty: string }): string;
};

type OAuthClient = {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
};

type PendingRequest = {
  id: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  resource: string;
  scopes: readonly string[];
  expiresAtMs: number;
};

type Session = {
  userId: string;
  csrf: string;
  expiresAtMs: number;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  userId: string;
  resource: string;
  scopes: readonly string[];
  expiresAtMs: number;
};

type RefreshToken = {
  clientId: string;
  userId: string;
  resource: string;
  scopes: readonly string[];
  expiresAtMs: number;
};

export function attachConnect(app: express.Express, options: ConnectOptions): {
  redeem(grant: string, body: Record<string, unknown>): RedeemedToken;
} {
  const clients = new Map<string, OAuthClient>();
  const pending = new Map<string, PendingRequest>();
  const sessions = new Map<string, Session>();
  const codes = new Map<string, AuthorizationCode>();
  const refreshTokens = new Map<string, RefreshToken>();

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.status(200).json(authorizationServerMetadata(options.config));
  });
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.status(200).json(authorizationServerMetadata(options.config));
  });

  app.post("/oauth/register", route(async (req, res) => {
    const client = registerClient(readRecord(req.body));
    clients.set(client.clientId, client);
    res.status(201).json({
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }));

  app.get("/", (req, res) => {
    const account = currentAccount(req);
    sendHtml(res, 200, account ? accountPage(account) : signedOutPage());
  });

  app.get("/login", (req, res) => {
    const requestId = queryString(req.query.request);
    const account = currentAccount(req);
    if (account && requestId && pending.get(requestId)) {
      res.redirect(302, consentPath(requestId));
      return;
    }
    if (account) {
      res.redirect(302, "/");
      return;
    }
    sendHtml(res, 200, loginPage({ ...(requestId ? { requestId } : {}) }));
  });

  app.post("/login", (req, res) => {
    const body = readRecord(req.body);
    const email = formString(body, "email");
    const password = formString(body, "password");
    const requestId = formString(body, "request");
    if (!email || !password) {
      sendHtml(res, 400, loginPage({
        ...(requestId ? { requestId } : {}),
        ...(email ? { email } : {}),
        error: "Email and password are required.",
      }));
      return;
    }
    const account = options.directory.authenticate(email, password);
    if (!account) {
      sendHtml(res, 401, loginPage({
        ...(requestId ? { requestId } : {}),
        email,
        error: "Wrong email or password.",
      }));
      return;
    }
    startSession(res, account.userId);
    res.redirect(302, continueTo(requestId));
  });

  app.get("/signup", (req, res) => {
    const requestId = queryString(req.query.request);
    const account = currentAccount(req);
    if (account && requestId && pending.get(requestId)) {
      res.redirect(302, consentPath(requestId));
      return;
    }
    if (account) {
      res.redirect(302, "/");
      return;
    }
    sendHtml(res, 200, signupPage({ ...(requestId ? { requestId } : {}) }));
  });

  app.post("/signup", route(async (req, res) => {
    const body = readRecord(req.body);
    const name = formString(body, "name");
    const email = formString(body, "email");
    const password = formString(body, "password");
    const requestId = formString(body, "request");
    const error = signupError(name, email, password);
    if (error) {
      sendHtml(res, 400, signupPage({
        ...(requestId ? { requestId } : {}),
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
        error,
      }));
      return;
    }
    try {
      const account = await options.directory.create({ email, password, name });
      startSession(res, account.userId);
      res.redirect(302, continueTo(requestId));
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        sendHtml(res, 409, signupPage({
          ...(requestId ? { requestId } : {}),
          email,
          name,
          error: "An account with that email already exists.",
        }));
        return;
      }
      if (error instanceof DomainError) {
        sendHtml(res, 503, messagePage("Northwharf isn't ready", error.message));
        return;
      }
      throw error;
    }
  }));

  app.post("/logout", (req, res) => {
    const sessionId = readCookie(req, sessionCookie);
    if (sessionId) {
      sessions.delete(sessionId);
    }
    res.clearCookie(sessionCookie, { path: "/" });
    const requestId = formString(readRecord(req.body), "request");
    res.redirect(302, requestId && pending.has(requestId) ? `/login?request=${encodeURIComponent(requestId)}` : "/");
  });

  app.get("/authorize", (req, res) => {
    const parsed = parseAuthorize(req);
    if (!parsed.ok) {
      if (parsed.redirectUri) {
        redirectError(res, parsed.redirectUri, parsed.oauthError, parsed.state);
        return;
      }
      sendHtml(res, parsed.status, messagePage("Can't start the connection", parsed.message));
      return;
    }
    const id = randomId();
    pending.set(id, {
      id,
      clientId: parsed.client.clientId,
      redirectUri: parsed.redirectUri,
      challenge: parsed.challenge,
      state: parsed.state,
      resource: parsed.resource,
      scopes: parsed.scopes,
      expiresAtMs: options.now().getTime() + pendingTtlMs,
    });
    if (!currentAccount(req)) {
      res.redirect(302, `/login?request=${encodeURIComponent(id)}`);
      return;
    }
    res.redirect(302, consentPath(id));
  });

  app.get("/consent", (req, res) => {
    const requestId = queryString(req.query.request);
    const account = currentAccount(req);
    if (!account) {
      res.redirect(302, requestId ? `/login?request=${encodeURIComponent(requestId)}` : "/login");
      return;
    }
    const stored = requestId ? takePending(requestId, false) : undefined;
    if (!stored) {
      sendHtml(res, 400, messagePage("Connection expired", "This MCP connection request expired. Start it again from the client."));
      return;
    }
    const client = clients.get(stored.clientId);
    if (!client) {
      sendHtml(res, 400, messagePage("Connection expired", "This MCP client is no longer registered."));
      return;
    }
    const session = currentSession(req);
    if (!session) {
      res.redirect(302, "/login");
      return;
    }
    const grantable = stored.scopes.filter((scope) => account.permissions.includes(scope));
    if (grantable.length === 0) {
      sendHtml(res, 403, messagePage("Nothing to approve", "This account has none of the permissions the client asked for."));
      return;
    }
    sendHtml(res, 200, consentPage({
      account,
      clientName: client.name,
      redirectHost: redirectHost(stored.redirectUri),
      loopback: isLoopback(stored.redirectUri),
      scopes: grantable.map((scope) => ({ scope, label: scopeLabel(scope) })),
      requestId: stored.id,
      csrf: session.csrf,
    }));
  });

  app.post("/consent", (req, res) => {
    const body = readRecord(req.body);
    const requestId = formString(body, "request");
    const csrf = formString(body, "csrf");
    const decision = formString(body, "decision");
    const session = currentSession(req);
    const account = session ? options.directory.findById(session.userId) : undefined;
    if (!session || !account || !safeEqual(csrf, session.csrf)) {
      sendHtml(res, 401, messagePage("Sign in required", "Sign in before approving an MCP connection."));
      return;
    }
    const stored = takePending(requestId, true);
    if (!stored) {
      sendHtml(res, 400, messagePage("Connection expired", "This MCP connection request expired. Start it again from the client."));
      return;
    }
    const client = clients.get(stored.clientId);
    if (!client || !client.redirectUris.includes(stored.redirectUri)) {
      sendHtml(res, 400, messagePage("Connection expired", "This MCP client is no longer registered."));
      return;
    }
    if (decision === "deny") {
      redirectError(res, stored.redirectUri, "access_denied", stored.state);
      return;
    }
    if (decision !== "approve") {
      sendHtml(res, 400, messagePage("Choose allow or deny", "Approve or deny the connection."));
      return;
    }
    const scopes = stored.scopes.filter((scope) => account.permissions.includes(scope));
    if (scopes.length === 0) {
      redirectError(res, stored.redirectUri, "access_denied", stored.state);
      return;
    }
    const code = randomId();
    codes.set(digest(code), {
      clientId: stored.clientId,
      redirectUri: stored.redirectUri,
      challenge: stored.challenge,
      userId: account.userId,
      resource: stored.resource,
      scopes,
      expiresAtMs: options.now().getTime() + codeTtlMs,
    });
    const target = new URL(stored.redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", stored.state);
    res.redirect(302, target.toString());
  });

  return {
    redeem(grant, body) {
      if (grant === "authorization_code") {
        return redeemCode(body);
      }
      if (grant === "refresh_token") {
        return redeemRefresh(body);
      }
      throw new RequestError(400, "unsupported_grant_type", "Grant type is not supported", "oauth");
    },
  };

  function redeemCode(body: Record<string, unknown>): RedeemedToken {
    const clientId = readString(body, "client_id");
    const code = readString(body, "code");
    const verifier = readString(body, "code_verifier");
    const redirectUri = readString(body, "redirect_uri");
    const resource = readString(body, "resource");
    if (!clientId || !clients.has(clientId)) {
      throw new RequestError(401, "invalid_client", "Unknown client", "oauth");
    }
    if (readString(body, "client_secret") !== undefined) {
      throw new RequestError(401, "invalid_client", "This client has no secret", "oauth");
    }
    if (!code || !verifier || !redirectUri || !resource) {
      throw new RequestError(400, "invalid_grant", "Authorization code is invalid", "oauth");
    }
    const key = digest(code);
    const stored = codes.get(key);
    codes.delete(key);
    if (!stored || stored.expiresAtMs <= options.now().getTime()) {
      throw new RequestError(400, "invalid_grant", "Authorization code is invalid", "oauth");
    }
    if (
      stored.clientId !== clientId
      || stored.redirectUri !== redirectUri
      || stored.resource !== resource
      || !verifierPattern.test(verifier)
      || !pkceMatches(verifier, stored.challenge)
    ) {
      throw new RequestError(400, "invalid_grant", "Authorization code is invalid", "oauth");
    }
    const account = options.directory.findById(stored.userId);
    if (!account) {
      throw new RequestError(400, "invalid_grant", "Authorization code is invalid", "oauth");
    }
    return issueFor(account, clientId, stored.resource, stored.scopes, "authorization_code");
  }

  function redeemRefresh(body: Record<string, unknown>): RedeemedToken {
    const clientId = readString(body, "client_id");
    const token = readString(body, "refresh_token");
    const resource = readString(body, "resource");
    if (!clientId || !clients.has(clientId)) {
      throw new RequestError(401, "invalid_client", "Unknown client", "oauth");
    }
    if (readString(body, "client_secret") !== undefined) {
      throw new RequestError(401, "invalid_client", "This client has no secret", "oauth");
    }
    if (!token || !resource) {
      throw new RequestError(400, "invalid_grant", "Refresh token is invalid", "oauth");
    }
    const key = digest(token);
    const stored = refreshTokens.get(key);
    refreshTokens.delete(key);
    if (!stored || stored.expiresAtMs <= options.now().getTime()) {
      throw new RequestError(400, "invalid_grant", "Refresh token is invalid", "oauth");
    }
    if (stored.clientId !== clientId || stored.resource !== resource) {
      throw new RequestError(400, "invalid_grant", "Refresh token is invalid", "oauth");
    }
    const account = options.directory.findById(stored.userId);
    if (!account) {
      throw new RequestError(400, "invalid_grant", "Refresh token is invalid", "oauth");
    }
    const scopes = stored.scopes.filter((scope) => account.permissions.includes(scope));
    if (scopes.length === 0) {
      throw new RequestError(400, "invalid_grant", "Refresh token is invalid", "oauth");
    }
    return issueFor(account, clientId, stored.resource, scopes, "refresh_token");
  }

  function issueFor(
    account: Account,
    clientId: string,
    resource: string,
    scopes: readonly string[],
    gty: string,
  ): RedeemedToken {
    const accessToken = options.signAccessToken({ account, scopes, clientId, gty });
    const refreshToken = randomId();
    refreshTokens.set(digest(refreshToken), {
      clientId,
      userId: account.userId,
      resource,
      scopes,
      expiresAtMs: options.now().getTime() + refreshTtlMs,
    });
    return { accessToken, refreshToken, scope: scopes.join(" ") };
  }

  function parseAuthorize(req: Request):
    | {
      ok: true;
      client: OAuthClient;
      redirectUri: string;
      challenge: string;
      state: string;
      resource: string;
      scopes: readonly string[];
    }
    | {
      ok: false;
      status: number;
      message: string;
      oauthError: string;
      redirectUri?: string;
      state?: string;
    } {
    const clientId = queryString(req.query.client_id);
    const redirectUri = queryString(req.query.redirect_uri);
    const client = clientId ? clients.get(clientId) : undefined;
    const redirectOk = client !== undefined && redirectUri !== undefined && client.redirectUris.includes(redirectUri);
    const state = queryString(req.query.state);
    if (!client || !redirectUri || !redirectOk) {
      return {
        ok: false,
        status: 400,
        message: "The client or redirect URL is not registered.",
        oauthError: "invalid_request",
      };
    }
    const fail = (oauthError: string, message: string): {
      ok: false;
      status: number;
      message: string;
      oauthError: string;
      redirectUri: string;
      state?: string;
    } => ({
      ok: false,
      status: 400,
      message,
      oauthError,
      redirectUri,
      ...(state ? { state } : {}),
    });
    if (queryString(req.query.response_type) !== "code") {
      return fail("invalid_request", "response_type must be code.");
    }
    if (!state || state.length > 512 || /[\u0000-\u001f\u007f]/.test(state)) {
      return {
        ok: false,
        status: 400,
        message: "state is required.",
        oauthError: "invalid_request",
        redirectUri,
      };
    }
    const method = queryString(req.query.code_challenge_method);
    const challenge = queryString(req.query.code_challenge);
    if (method !== "S256" || !challenge || challenge.length > 128) {
      return fail("invalid_request", "PKCE S256 is required.");
    }
    const resource = queryString(req.query.resource);
    if (resource !== options.config.apiAudience) {
      return fail("invalid_target", "The resource does not match this API.");
    }
    const requested = queryString(req.query.scope);
    const supported = new Set<string>(accessPermissions);
    const scopes = requested ? requested.split(" ").filter((scope) => scope.length > 0) : [...accessPermissions];
    if (scopes.length === 0 || scopes.some((scope) => !supported.has(scope))) {
      return fail("invalid_scope", "One or more scopes are not supported.");
    }
    return { ok: true, client, redirectUri, challenge, state, resource, scopes };
  }

  function currentAccount(req: Request): Account | undefined {
    const session = currentSession(req);
    if (!session) {
      return undefined;
    }
    return options.directory.findById(session.userId);
  }

  function currentSession(req: Request): Session | undefined {
    const sessionId = readCookie(req, sessionCookie);
    if (!sessionId) {
      return undefined;
    }
    const session = sessions.get(sessionId);
    if (!session || session.expiresAtMs <= options.now().getTime()) {
      if (sessionId) {
        sessions.delete(sessionId);
      }
      return undefined;
    }
    return session;
  }

  function startSession(res: Response, userId: string): void {
    const sessionId = randomId();
    sessions.set(sessionId, {
      userId,
      csrf: randomId(),
      expiresAtMs: options.now().getTime() + sessionTtlMs,
    });
    res.cookie(sessionCookie, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtlMs,
    });
  }

  function takePending(id: string, consume: boolean): PendingRequest | undefined {
    const stored = pending.get(id);
    if (!stored) {
      return undefined;
    }
    if (stored.expiresAtMs <= options.now().getTime()) {
      pending.delete(id);
      return undefined;
    }
    if (consume) {
      pending.delete(id);
    }
    return stored;
  }

  function continueTo(requestId: string): string {
    return requestId && pending.has(requestId) ? consentPath(requestId) : "/";
  }
}

export function authorizationServerMetadata(config: IdentityConfig): Record<string, unknown> {
  const base = new URL(config.issuer).origin;
  return {
    issuer: config.issuer,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    scopes_supported: [...accessPermissions],
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "client_credentials",
      "password",
      passwordRealmGrant,
    ],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

function registerClient(body: Record<string, unknown>): OAuthClient {
  const redirectUris = readStringList(body, "redirect_uris");
  if (redirectUris.length === 0 || redirectUris.length > 8) {
    throw new RequestError(400, "invalid_client_metadata", "redirect_uris must list 1 to 8 URLs", "oauth");
  }
  if (redirectUris.some((uri) => !isAllowedRedirect(uri))) {
    throw new RequestError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must be a loopback http URL, the Cursor cloud callback, or the Cursor app callback",
      "oauth",
    );
  }
  const method = readString(body, "token_endpoint_auth_method") ?? "none";
  if (method !== "none") {
    throw new RequestError(400, "invalid_client_metadata", "Only public clients are accepted", "oauth");
  }
  const grants = readStringList(body, "grant_types");
  if (grants.length > 0 && grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) {
    throw new RequestError(400, "invalid_client_metadata", "grant_types must be authorization_code and refresh_token", "oauth");
  }
  const responses = readStringList(body, "response_types");
  if (responses.length > 0 && (responses.length !== 1 || responses[0] !== "code")) {
    throw new RequestError(400, "invalid_client_metadata", "response_types must be code", "oauth");
  }
  const name = readString(body, "client_name") ?? "MCP client";
  if (name.length > 120) {
    throw new RequestError(400, "invalid_client_metadata", "client_name is too long", "oauth");
  }
  return { clientId: randomId(), name, redirectUris };
}

export function isAllowedRedirect(value: string): boolean {
  if (value === cursorCallback || value === cursorCloudCallback) {
    return true;
  }
  if (value.length > 500) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function isLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function redirectHost(value: string): string {
  if (value === cursorCallback) {
    return "the Cursor app";
  }
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function redirectError(res: Response, redirectUri: string, error: string, state: string | undefined): void {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  if (state) {
    target.searchParams.set("state", state);
  }
  res.redirect(302, target.toString());
}

function consentPath(requestId: string): string {
  return `/consent?request=${encodeURIComponent(requestId)}`;
}

function signupError(name: string, email: string, password: string): string | undefined {
  if (!name || name.length > 200) {
    return "Enter your name.";
  }
  if (!email || !emailPattern.test(email) || email.length > 200) {
    return "Enter a valid email.";
  }
  if (password.length < 8 || password.length > 200) {
    return "Password must be 8 to 200 characters.";
  }
  return undefined;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(challenge);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function randomId(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function sendHtml(res: Response, status: number, body: string): void {
  res.status(status);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.send(body);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.header("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    if (trimmed.slice(0, separator) !== name) {
      continue;
    }
    try {
      return decodeURIComponent(trimmed.slice(separator + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function queryString(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function formString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = formString(body, key);
  return value.length > 0 ? value : undefined;
}

function readStringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}
