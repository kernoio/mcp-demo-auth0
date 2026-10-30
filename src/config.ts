import { ownerSubject } from "./auth/permissions.js";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  authIssuer: string;
  authAudience: string;
  authJwksUrl: string;
  ownerSubject: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: readPort(env.PORT),
    databaseUrl: required(env, "DATABASE_URL"),
    authIssuer: firstPresent(env, ["AUTH0_ISSUER", "AUTH0_ISSUER_BASE_URL"]),
    authAudience: required(env, "AUTH0_AUDIENCE"),
    authJwksUrl: required(env, "AUTH0_JWKS_URL"),
    ownerSubject: env.AUTH0_OWNER_SUBJECT?.trim() || ownerSubject,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function firstPresent(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing ${names.join(" or ")}`);
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 8080;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}
