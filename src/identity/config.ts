import { ownerSubject } from "../auth/permissions.js";

export type IdentityConfig = {
  issuer: string;
  apiAudience: string;
  managementAudience: string;
  clientId: string;
  clientSecret: string;
  ownerSubject: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
};

export type IdentityProcessConfig = IdentityConfig & {
  port: number;
  databaseUrl: string;
};

const ownerEmail = "ada.north@northwharf.example";
const ownerName = "Ada North";

export function managementAudienceFor(issuer: string): string {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return `${base}api/v2/`;
}

export function readIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityProcessConfig {
  const issuer = required(env, "AUTH0_ISSUER");
  const apiAudience = required(env, "AUTH0_AUDIENCE");
  const managementAudience = managementAudienceFor(issuer);
  if (apiAudience === managementAudience) {
    throw new Error("AUTH0_AUDIENCE must differ from the Management API audience");
  }
  return {
    port: readPort(env.AUTH0_PORT),
    databaseUrl: required(env, "DATABASE_URL"),
    issuer,
    apiAudience,
    managementAudience,
    clientId: required(env, "AUTH0_MGMT_CLIENT_ID"),
    clientSecret: required(env, "AUTH0_MGMT_CLIENT_SECRET"),
    ownerSubject: env.AUTH0_OWNER_SUBJECT?.trim() || ownerSubject,
    ownerEmail: env.AUTH0_OWNER_EMAIL?.trim() || ownerEmail,
    ownerName: env.AUTH0_OWNER_NAME?.trim() || ownerName,
    ownerPassword: required(env, "AUTH0_OWNER_PASSWORD"),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AUTH0_PORT must be an integer from 1 to 65535");
  }
  return port;
}
