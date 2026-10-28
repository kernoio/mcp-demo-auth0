import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { DomainError } from "../domain/errors.js";
import type { AppConfig } from "../config.js";

export type VerifiedAccess = {
  subject: string;
  permissions: readonly string[];
};

export type AccessVerifier = (authorizationHeader: string | undefined) => Promise<VerifiedAccess>;

export function createAccessVerifier(config: Pick<AppConfig, "authJwksUrl" | "authIssuer" | "authAudience">): AccessVerifier {
  const keys = createRemoteJWKSet(new URL(config.authJwksUrl));
  return async (authorizationHeader) => {
    const token = bearerToken(authorizationHeader);
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.authIssuer,
        audience: config.authAudience,
      });
      const subject = payload.sub;
      if (typeof subject !== "string" || subject.length === 0) {
        throw new DomainError("unauthenticated", "Token has no subject");
      }
      return { subject, permissions: readPermissions(payload) };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError("unauthenticated", "Bearer token was rejected");
    }
  };
}

function bearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new DomainError("unauthenticated", "Authorization bearer token is required");
  }
  const [scheme, token, extra] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token || extra !== undefined) {
    throw new DomainError("unauthenticated", "Authorization bearer token is required");
  }
  return token;
}

function readPermissions(payload: JWTPayload): readonly string[] {
  const value = payload["permissions"];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
