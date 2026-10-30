import { AuthClient, TokenByClientCredentialsError } from "@auth0/auth0-auth-js";
import { UsersClient } from "auth0/users";

const databaseConnection = "Username-Password-Authentication";

export type Auth0ClientConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  /**
   * Origin the issuer is actually reachable at, when that is not
   * `https://<issuer host>`. The local stand-in listens on plain HTTP while
   * tokens still use `https://auth.northwharf.local/` as `iss`.
   */
  baseUrl?: string;
};

export type NewAuth0User = {
  email: string;
  password: string;
  name?: string;
  emailVerified?: boolean;
  permissions?: readonly string[];
};

export type CreatedAuth0User = {
  userId: string;
};

export type Auth0Client = {
  passwordGrant(username: string, password: string): Promise<string>;
  createUser(user: NewAuth0User): Promise<CreatedAuth0User>;
  rejectIncorrectManagementSecret(): Promise<void>;
};

export function createAuth0Client(config: Auth0ClientConfig): Auth0Client {
  const issuer = new URL(config.issuer);
  const domain = issuer.host;
  const origin = (config.baseUrl ? new URL(config.baseUrl) : new URL(`https://${domain}`)).origin;
  const customFetch = rewriteIssuerFetch(`https://${domain}`, origin);
  const audience = managementAudience(config.issuer);
  const auth = new AuthClient({
    domain,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    customFetch,
  });
  let cachedManagementToken: { value: string; expiresAtMs: number } | undefined;
  const users = new UsersClient({
    baseUrl: `${origin}/api/v2`,
    maxRetries: 0,
    token: async () => {
      if (cachedManagementToken && cachedManagementToken.expiresAtMs > Date.now() + 10_000) {
        return cachedManagementToken.value;
      }
      const tokens = await auth.getTokenByClientCredentials({ audience });
      cachedManagementToken = { value: tokens.accessToken, expiresAtMs: tokens.expiresAt * 1000 };
      return tokens.accessToken;
    },
  });

  return {
    async passwordGrant(username, password) {
      const tokens = await auth.getTokenByPassword({
        username,
        password,
        audience: config.audience,
      });
      return tokens.accessToken;
    },
    async createUser(user) {
      const created = await users.create({
        connection: databaseConnection,
        email: user.email,
        password: user.password,
        email_verified: user.emailVerified ?? false,
        ...(user.name === undefined ? {} : { name: user.name }),
        ...(user.permissions === undefined ? {} : { app_metadata: { permissions: [...user.permissions] } }),
      });
      if (!created.user_id) {
        throw new Error("Auth0 did not return a user id");
      }
      return { userId: created.user_id };
    },
    async rejectIncorrectManagementSecret() {
      const incorrect = new AuthClient({
        domain,
        clientId: config.clientId,
        clientSecret: `${config.clientSecret}-incorrect`,
        customFetch,
      });
      try {
        await incorrect.getTokenByClientCredentials({ audience });
      } catch (error) {
        if (error instanceof TokenByClientCredentialsError && error.statusCode === 401) {
          return;
        }
        throw error;
      }
      throw new Error("client credentials with the wrong secret succeeded");
    },
  };
}

function managementAudience(issuer: string): string {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return `${base}api/v2/`;
}

function rewriteIssuerFetch(fromOrigin: string, toOrigin: string): typeof fetch {
  if (fromOrigin === toOrigin) {
    return fetch;
  }
  return (input, init) => {
    const current = requestUrl(input);
    if (!current.startsWith(fromOrigin)) {
      return fetch(input, init);
    }
    const rewritten = `${toOrigin}${current.slice(fromOrigin.length)}`;
    if (input instanceof Request) {
      return fetch(new Request(rewritten, input), init);
    }
    return fetch(rewritten, init);
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
