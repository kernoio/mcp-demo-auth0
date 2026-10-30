import {
  generateKeyPairSync,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

export type SigningKeys = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  jwks: { keys: PublicJwk[] };
};

export type VerifiedJwt = {
  iss: string;
  sub: string;
  aud: string | string[];
  scope: string;
  exp: number;
};

type PublicJwk = JsonWebKey & { kid: string; alg: string; use: string };

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

const clockSkewSeconds = 5;

export function createSigningKeys(): SigningKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported = publicKey.export({ format: "jwk" });
  if (exported.kty !== "RSA" || !exported.n || !exported.e) {
    throw new Error("RSA public key is incomplete");
  }
  const kid = "northwharf-auth0";
  const jwk: PublicJwk = {
    kty: exported.kty,
    n: exported.n,
    e: exported.e,
    kid,
    alg: "RS256",
    use: "sig",
  };
  return { kid, privateKey, publicKey, jwks: { keys: [jwk] } };
}

export function signJwt(keys: SigningKeys, payload: Record<string, unknown>): string {
  const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keys.kid }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), keys.privateKey);
  return `${input}.${base64url(signature)}`;
}

export function verifyJwt(keys: SigningKeys, token: string, expectedIssuer: string, nowSeconds: number): VerifiedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenError("Invalid token");
  }
  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new TokenError("Invalid token");
  }
  const header = parseObject(encodedHeader);
  if (header.alg !== "RS256" || header.kid !== keys.kid) {
    throw new TokenError("Invalid token");
  }
  const signature = decode(encodedSignature);
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    keys.publicKey,
    signature,
  );
  if (!valid) {
    throw new TokenError("Invalid token");
  }
  const payload = parseObject(encodedPayload);
  if (payload.iss !== expectedIssuer || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new TokenError("Invalid token");
  }
  const aud = readAudience(payload.aud);
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - clockSkewSeconds) {
    throw new TokenError("Invalid token");
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds + clockSkewSeconds) {
    throw new TokenError("Invalid token");
  }
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  return { iss: expectedIssuer, sub: payload.sub, aud, scope, exp: payload.exp };
}

function readAudience(aud: unknown): string | string[] {
  if (typeof aud === "string" && aud.length > 0) {
    return aud;
  }
  if (Array.isArray(aud) && aud.every((item): item is string => typeof item === "string" && item.length > 0)) {
    return aud;
  }
  throw new TokenError("Invalid token");
}

export function audienceIncludes(aud: string | readonly string[], expected: string): boolean {
  return typeof aud === "string" ? aud === expected : aud.includes(expected);
}

function parseObject(encoded: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(decode(encoded).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TokenError("Invalid token");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TokenError) {
      throw error;
    }
    throw new TokenError("Invalid token");
  }
}

function decode(encoded: string): Buffer {
  return Buffer.from(encoded, "base64url");
}

function base64url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer.toString("base64url");
}
