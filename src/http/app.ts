import type { IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { UnauthorizedError } from "express-oauth2-jwt-bearer";
import { accessStore } from "../auth/context.js";
import { accessPermissions } from "../auth/permissions.js";
import { authErrorHandler, resolveAccess } from "../auth/verify.js";
import type { Database } from "../db/client.js";
import { memberExists } from "../db/store.js";
import { DomainError } from "../domain/errors.js";
import { createNorthwharfServer } from "../mcp/server.js";

export type McpDiscovery = {
  resource: string;
  authorizationServer: string;
};

export function createApp(db: Database, authenticate: RequestHandler, discovery: McpDiscovery): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  const challenge = wwwAuthenticate(discovery);
  const document = protectedResourceDocument(discovery);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  for (const path of protectedResourcePaths(discovery.resource)) {
    app.get(path, (_req, res) => {
      res.status(200).json(document);
    });
  }

  app.post("/mcp", authenticate, (req, res, next) => {
    void handleMcp(db, req, res).catch(next);
  });
  app.get("/mcp", authenticate, (req, res, next) => {
    void rejectSessionStream(db, req, res).catch(next);
  });
  app.delete("/mcp", authenticate, (req, res, next) => {
    void rejectSessionStream(db, req, res).catch(next);
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!res.headersSent && isUnauthenticated(error)) {
      res.setHeader("WWW-Authenticate", challenge);
    }
    authErrorHandler(error, req, res, next);
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "bad_request", message: "Request body is not JSON" });
      return;
    }
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "unexpected", message: "Unexpected failure" });
    }
  });

  return app;
}

async function handleMcp(db: Database, req: Request, res: Response): Promise<void> {
  const access = await resolveAccess(req, (subject) => memberExists(db, subject));

  const server = createNorthwharfServer(db);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await accessStore.run(access, async () => {
      await server.connect(transport);
      Reflect.deleteProperty(req, "auth");
      const message: IncomingMessage = req;
      await transport.handleRequest(message, res, req.body);
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Unexpected failure" },
        id: null,
      });
    }
  }
}

function protectedResourceDocument(discovery: McpDiscovery): Record<string, unknown> {
  return {
    resource: discovery.resource,
    authorization_servers: [discovery.authorizationServer],
    scopes_supported: [...accessPermissions],
    bearer_methods_supported: ["header"],
  };
}

function protectedResourcePaths(resource: string): string[] {
  const url = new URL(resource);
  const paths = ["/.well-known/oauth-protected-resource"];
  if (url.pathname !== "/" && url.pathname !== "") {
    paths.push(`/.well-known/oauth-protected-resource${url.pathname.replace(/\/$/, "")}`);
  }
  return paths;
}

function wwwAuthenticate(discovery: McpDiscovery): string {
  const metadata = protectedResourceMetadataUrl(discovery.resource);
  return `Bearer resource_metadata="${metadata}", scope="${accessPermissions.join(" ")}"`;
}

function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}/.well-known/oauth-protected-resource${suffix}`;
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof UnauthorizedError || (error instanceof DomainError && error.code === "unauthenticated");
}

async function rejectSessionStream(db: Database, req: Request, res: Response): Promise<void> {
  await resolveAccess(req, (subject) => memberExists(db, subject));
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}
