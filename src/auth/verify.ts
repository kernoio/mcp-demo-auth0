import {
  auth,
  UnauthorizedError,
  type JWTPayload,
} from "express-oauth2-jwt-bearer";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";

export type VerifiedAccess = {
  subject: string;
  permissions: readonly string[];
};

export type MemberLookup = (subject: string) => Promise<boolean>;

export function createBearerAuthenticator(
  config: Pick<AppConfig, "authIssuer" | "authAudience" | "authJwksUrl">,
): RequestHandler {
  return auth({
    issuer: config.authIssuer,
    audience: config.authAudience,
    jwksUri: config.authJwksUrl,
  });
}

export async function resolveAccess(req: Request, memberExists: MemberLookup): Promise<VerifiedAccess> {
  const payload = req.auth?.payload;
  if (!payload) {
    throw new DomainError("unauthenticated", "Authorization bearer token is required");
  }
  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new DomainError("unauthenticated", "Token has no subject");
  }
  if (!(await memberExists(subject))) {
    throw new DomainError("forbidden", "No Northwharf member matches this token subject");
  }
  return { subject, permissions: readPermissions(payload) };
}

export function authErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof DomainError && error.code === "forbidden") {
    res.status(403).json({ error: "forbidden", message: error.message });
    return;
  }
  if (error instanceof DomainError && error.code === "unauthenticated") {
    res.status(401).json({ error: "unauthenticated", message: error.message });
    return;
  }
  if (error instanceof UnauthorizedError) {
    res.status(401).json({
      error: "unauthenticated",
      message: error.message || "Bearer token was rejected",
    });
    return;
  }
  next(error);
}

function readPermissions(payload: JWTPayload): readonly string[] {
  const value = payload["permissions"];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
