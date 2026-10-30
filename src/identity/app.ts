import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { accessPermissions } from "../auth/permissions.js";
import { DomainError } from "../domain/errors.js";
import { attachConnect } from "./connect.js";
import type { IdentityConfig } from "./config.js";
import { RequestError } from "./errors.js";
import { audienceIncludes, signJwt, verifyJwt, type SigningKeys } from "./tokens.js";

const databaseConnection = "Username-Password-Authentication";
const passwordRealmGrant = "http://auth0.com/oauth/grant-type/password-realm";
const managementScope = "create:users read:users";
const tokenTtlSeconds = 3600;
const emailPattern = /^[^\s@]+@[^\s@]+$/;

export type MemberProvision = {
  subject: string;
  email: string;
  displayName: string;
};

export type IdentityAppOptions = {
  config: IdentityConfig;
  keys: SigningKeys;
  provisionMember: (input: MemberProvision) => Promise<void>;
  now?: () => Date;
};

type DirectoryUser = {
  userId: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string;
  name: string;
  givenName: string | null;
  familyName: string | null;
  nickname: string;
  permissions: readonly string[];
  createdAt: string;
  updatedAt: string;
};

export function createIdentityApp(options: IdentityAppOptions): express.Express {
  const { config, keys, provisionMember } = options;
  const now = options.now ?? (() => new Date());
  const usersByEmail = new Map<string, DirectoryUser>();
  const pendingEmails = new Set<string>();
  const dummyHash = hashPassword("northwharf-password-check");
  const ownerNames = splitName(config.ownerName);
  const createdAt = now().toISOString();
  usersByEmail.set(emailKey(config.ownerEmail), {
    userId: config.ownerSubject,
    email: config.ownerEmail,
    emailVerified: true,
    passwordHash: hashPassword(config.ownerPassword),
    name: config.ownerName,
    givenName: ownerNames.givenName,
    familyName: ownerNames.familyName,
    nickname: "ada",
    permissions: [...accessPermissions],
    createdAt,
    updatedAt: createdAt,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.set("cache-control", "public, max-age=60");
    res.status(200).json(keys.jwks);
  });

  const browser = attachConnect(app, {
    config,
    now,
    directory: {
      authenticate(email, password) {
        const user = usersByEmail.get(emailKey(email));
        const matches = passwordMatches(password, user?.passwordHash ?? dummyHash);
        if (!user || !matches) {
          return undefined;
        }
        return toAccount(user);
      },
      async create(input) {
        const names = splitName(input.name);
        const user = await createDirectoryUser({
          email: input.email,
          password: input.password,
          emailVerified: true,
          name: input.name,
          givenName: names.givenName,
          familyName: names.familyName,
          permissions: [...accessPermissions],
          config,
          now,
          usersByEmail,
          pendingEmails,
          provisionMember,
        });
        return toAccount(user);
      },
      findById(userId) {
        for (const user of usersByEmail.values()) {
          if (user.userId === userId) {
            return toAccount(user);
          }
        }
        return undefined;
      },
    },
    signAccessToken(input) {
      return issue(keys, config, now, {
        sub: input.account.userId,
        aud: config.apiAudience,
        scope: input.scopes.join(" "),
        permissions: [...input.scopes],
        gty: input.gty,
        azp: input.clientId,
      });
    },
  });

  app.post("/oauth/token", route(async (req, res) => {
    const body = readRecord(req.body);
    const grant = readString(body, "grant_type");
    if (!grant) {
      throw new RequestError(400, "invalid_request", "grant_type is required", "oauth");
    }
    if (grant === "authorization_code" || grant === "refresh_token") {
      const issued = browser.redeem(grant, body);
      res.status(200).json({
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: tokenTtlSeconds,
        refresh_token: issued.refreshToken,
        scope: issued.scope,
      });
      return;
    }
    const credentials = readCredentials(req, body);
    if (!credentialsMatch(config, credentials.id, credentials.secret)) {
      throw new RequestError(401, "access_denied", "Unauthorized", "oauth");
    }
    if (grant === "client_credentials") {
      writeManagementToken(res, body, config, keys, now);
      return;
    }
    if (grant === "password" || grant === passwordRealmGrant) {
      writeUserToken(res, body, grant, config, keys, now, usersByEmail, dummyHash);
      return;
    }
    throw new RequestError(400, "unsupported_grant_type", "Grant type is not supported", "oauth");
  }));

  app.post("/api/v2/users", route(async (req, res) => {
    requireManagement(req, config, keys, now);
    const body = readRecord(req.body);
    const email = readBounded(body, "email", 200);
    const password = readPassword(body);
    const connection = readString(body, "connection");
    if (!email || !emailPattern.test(email)) {
      throw new RequestError(400, "Bad Request", "A valid email is required", "management");
    }
    if (password === undefined) {
      throw new RequestError(400, "Bad Request", "password is required", "management");
    }
    if (password.length < 8 || password.length > 200) {
      throw new RequestError(400, "Bad Request", "password must be 8 to 200 characters", "management");
    }
    if (connection !== databaseConnection) {
      throw new RequestError(400, "Bad Request", "connection must be Username-Password-Authentication", "management");
    }
    const explicitPermissions = readPermissions(body);
    const name = readBounded(body, "name", 200) ?? email;
    const requestedGiven = readBounded(body, "given_name", 80);
    const requestedFamily = readBounded(body, "family_name", 80);
    const fallback = splitName(name);
    const user = await createDirectoryUser({
      email,
      password,
      emailVerified: readBoolean(body, "email_verified", false),
      name,
      givenName: requestedGiven ?? fallback.givenName,
      familyName: requestedFamily ?? fallback.familyName,
      permissions: explicitPermissions ?? [...accessPermissions],
      config,
      now,
      usersByEmail,
      pendingEmails,
      provisionMember,
    });
    res.status(201).json(toAuth0User(user));
  }));

  app.use((_req, res) => {
    res.status(404).json({ statusCode: 404, error: "Not Found", message: "Not Found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }
    if (error instanceof RequestError) {
      if (error.kind === "oauth") {
        res.status(error.status).json({ error: error.error, error_description: error.message });
        return;
      }
      res.status(error.status).json({ statusCode: error.status, error: error.error, message: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ statusCode: 400, error: "Bad Request", message: "Request body is not JSON" });
      return;
    }
    if (error instanceof DomainError && error.code === "invalid_state") {
      res.status(503).json({ statusCode: 503, error: "Service Unavailable", message: error.message });
      return;
    }
    if (postgresCode(error) === "23505") {
      res.status(409).json({ statusCode: 409, error: "Conflict", message: "The user already exists." });
      return;
    }
    console.error(error);
    res.status(500).json({ statusCode: 500, error: "Internal Server Error", message: "Unexpected failure" });
  });

  return app;
}

function writeManagementToken(
  res: Response,
  body: Record<string, unknown>,
  config: IdentityConfig,
  keys: SigningKeys,
  now: () => Date,
): void {
  const audience = readString(body, "audience");
  if (!audience) {
    throw new RequestError(400, "invalid_request", "audience is required", "oauth");
  }
  if (audience !== config.managementAudience) {
    throw new RequestError(403, "access_denied", "Client is not authorized for this audience", "oauth");
  }
  const accessToken = issue(keys, config, now, {
    sub: `${config.clientId}@clients`,
    aud: config.managementAudience,
    scope: managementScope,
    gty: "client-credentials",
    azp: config.clientId,
  });
  writeToken(res, accessToken, managementScope);
}

function writeUserToken(
  res: Response,
  body: Record<string, unknown>,
  grant: string,
  config: IdentityConfig,
  keys: SigningKeys,
  now: () => Date,
  usersByEmail: Map<string, DirectoryUser>,
  dummyHash: string,
): void {
  if (grant === passwordRealmGrant && readString(body, "realm") !== databaseConnection) {
    throw new RequestError(400, "invalid_request", "realm must be Username-Password-Authentication", "oauth");
  }
  const username = readString(body, "username");
  const password = readPassword(body);
  if (!username) {
    throw new RequestError(400, "invalid_request", "username is required", "oauth");
  }
  if (password === undefined) {
    throw new RequestError(400, "invalid_request", "password is required", "oauth");
  }
  const audience = readString(body, "audience") ?? config.apiAudience;
  if (audience !== config.apiAudience) {
    throw new RequestError(403, "access_denied", "Client is not authorized for this audience", "oauth");
  }
  const user = usersByEmail.get(emailKey(username));
  const matches = passwordMatches(password, user?.passwordHash ?? dummyHash);
  if (!user || !matches) {
    throw new RequestError(403, "invalid_grant", "Wrong email or password.", "oauth");
  }
  const scope = user.permissions.join(" ");
  const accessToken = issue(keys, config, now, {
    sub: user.userId,
    aud: config.apiAudience,
    scope,
    permissions: user.permissions,
    gty: "password",
    azp: config.clientId,
  });
  writeToken(res, accessToken, scope);
}

async function createDirectoryUser(input: {
  email: string;
  password: string;
  emailVerified: boolean;
  name: string;
  givenName: string | null;
  familyName: string | null;
  permissions: readonly string[];
  config: IdentityConfig;
  now: () => Date;
  usersByEmail: Map<string, DirectoryUser>;
  pendingEmails: Set<string>;
  provisionMember: (member: MemberProvision) => Promise<void>;
}): Promise<DirectoryUser> {
  const key = emailKey(input.email);
  if (input.usersByEmail.has(key) || input.pendingEmails.has(key)) {
    throw new RequestError(409, "Conflict", "The user already exists.", "management");
  }
  input.pendingEmails.add(key);
  try {
    const stamp = input.now().toISOString();
    const user: DirectoryUser = {
      userId: newUserId(input.config.ownerSubject, input.usersByEmail),
      email: input.email,
      emailVerified: input.emailVerified,
      passwordHash: hashPassword(input.password),
      name: input.name,
      givenName: input.givenName,
      familyName: input.familyName,
      nickname: nicknameFrom(input.email),
      permissions: unique(input.permissions),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await input.provisionMember({
      subject: user.userId,
      email: user.email,
      displayName: user.name,
    });
    input.usersByEmail.set(key, user);
    return user;
  } finally {
    input.pendingEmails.delete(key);
  }
}

function requireManagement(req: Request, config: IdentityConfig, keys: SigningKeys, now: () => Date): void {
  const token = bearerToken(req);
  if (!token) {
    throw new RequestError(401, "Unauthorized", "Invalid token", "management");
  }
  try {
    const verified = verifyJwt(keys, token, config.issuer, seconds(now()));
    if (!audienceIncludes(verified.aud, config.managementAudience)) {
      throw new RequestError(401, "Unauthorized", "Invalid token", "management");
    }
    const scopes = verified.scope.split(" ").filter((scope) => scope.length > 0);
    if (!scopes.includes("create:users")) {
      throw new RequestError(403, "Forbidden", "Insufficient scope", "management");
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(401, "Unauthorized", "Invalid token", "management");
  }
}

function issue(
  keys: SigningKeys,
  config: IdentityConfig,
  now: () => Date,
  claims: Record<string, unknown>,
): string {
  const issuedAt = seconds(now());
  return signJwt(keys, {
    ...claims,
    iss: config.issuer,
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + tokenTtlSeconds,
  });
}

function writeToken(res: Response, accessToken: string, scope: string): void {
  res.status(200).json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: tokenTtlSeconds,
    scope,
  });
}

function toAuth0User(user: DirectoryUser): Record<string, unknown> {
  const prefix = "auth0|";
  const identityUserId = user.userId.startsWith(prefix) ? user.userId.slice(prefix.length) : user.userId;
  return {
    user_id: user.userId,
    email: user.email,
    email_verified: user.emailVerified,
    name: user.name,
    nickname: user.nickname,
    ...(user.givenName ? { given_name: user.givenName } : {}),
    ...(user.familyName ? { family_name: user.familyName } : {}),
    identities: [
      {
        connection: databaseConnection,
        user_id: identityUserId,
        provider: "auth0",
        isSocial: false,
      },
    ],
    app_metadata: { permissions: user.permissions },
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    blocked: false,
    logins_count: 0,
  };
}

function readPermissions(body: Record<string, unknown>): readonly string[] | undefined {
  if (!Object.hasOwn(body, "app_metadata") || body.app_metadata === undefined) {
    return undefined;
  }
  const metadata = body.app_metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new RequestError(400, "Bad Request", "app_metadata must be an object", "management");
  }
  const record = metadata as Record<string, unknown>;
  if (!Object.hasOwn(record, "permissions")) {
    return undefined;
  }
  const permissions = record.permissions;
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== "string")) {
    throw new RequestError(400, "Bad Request", "app_metadata.permissions must be a list of strings", "management");
  }
  const allowed = new Set<string>(accessPermissions);
  if (permissions.some((item) => !allowed.has(item))) {
    throw new RequestError(400, "Bad Request", "app_metadata.permissions contains an unknown permission", "management");
  }
  return permissions;
}

function readBoolean(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (!Object.hasOwn(body, key) || body[key] === undefined) {
    return fallback;
  }
  const value = body[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new RequestError(400, "Bad Request", `${key} must be a boolean`, "management");
}

function readCredentials(req: Request, body: Record<string, unknown>): { id?: string; secret?: string } {
  const bodyId = readString(body, "client_id");
  const bodySecret = readPasswordField(body, "client_secret");
  if (bodyId !== undefined || bodySecret !== undefined) {
    return { ...(bodyId === undefined ? {} : { id: bodyId }), ...(bodySecret === undefined ? {} : { secret: bodySecret }) };
  }
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("basic ")) {
    return {};
  }
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return {};
  }
  const id = decoded.slice(0, separator);
  const secret = decoded.slice(separator + 1);
  return {
    ...(id.length > 0 ? { id } : {}),
    ...(secret.length > 0 ? { secret } : {}),
  };
}

function credentialsMatch(config: IdentityConfig, clientId: string | undefined, clientSecret: string | undefined): boolean {
  return safeEqual(clientId, config.clientId) && safeEqual(clientSecret, config.clientSecret);
}

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

function readRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBounded(body: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = readString(body, key);
  if (value !== undefined && value.length > max) {
    throw new RequestError(400, "Bad Request", `${key} is too long`, "management");
  }
  return value;
}

function readPassword(body: Record<string, unknown>): string | undefined {
  return readPasswordField(body, "password");
}

function readPasswordField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toAccount(user: DirectoryUser): { userId: string; email: string; name: string; permissions: readonly string[] } {
  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    permissions: user.permissions,
  };
}

function newUserId(ownerSubject: string, usersByEmail: Map<string, DirectoryUser>): string {
  const taken = new Set<string>([ownerSubject]);
  for (const user of usersByEmail.values()) {
    taken.add(user.userId);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const userId = `auth0|${randomBytes(12).toString("hex")}`;
    if (!taken.has(userId)) {
      return userId;
    }
  }
  throw new Error("Could not allocate a user id");
}

function emailKey(email: string): string {
  return email.toLowerCase();
}

function nicknameFrom(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 80);
}

function splitName(name: string): { givenName: string | null; familyName: string | null } {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const givenName = parts[0] ?? null;
  const family = parts.slice(1).join(" ");
  return { givenName, familyName: family.length > 0 ? family : null };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const parts = stored.split(":");
  const scheme = parts[0];
  const salt = parts[1];
  const hash = parts[2];
  if (scheme !== "scrypt" || !salt || !hash || parts.length !== 3) {
    return false;
  }
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

function safeEqual(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  if ("cause" in error) {
    return postgresCode(error.cause);
  }
  return undefined;
}

function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}
