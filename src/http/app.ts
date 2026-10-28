import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { accessStore } from "../auth/context.js";
import type { AccessVerifier } from "../auth/verify.js";
import { DomainError } from "../domain/errors.js";
import type { Database } from "../db/client.js";
import { createNorthwharfServer } from "../mcp/server.js";

export function createApp(db: Database, verify: AccessVerifier): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/mcp", (req, res) => {
    void handleMcp(db, verify, req, res);
  });
  app.get("/mcp", (req, res) => {
    void rejectSessionStream(verify, req, res);
  });
  app.delete("/mcp", (req, res) => {
    void rejectSessionStream(verify, req, res);
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

async function handleMcp(db: Database, verify: AccessVerifier, req: Request, res: Response): Promise<void> {
  let access;
  try {
    access = await verify(req.header("authorization"));
  } catch (error) {
    sendUnauthorized(res, error);
    return;
  }

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
      await transport.handleRequest(req, res, req.body);
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

async function rejectSessionStream(verify: AccessVerifier, req: Request, res: Response): Promise<void> {
  try {
    await verify(req.header("authorization"));
  } catch (error) {
    sendUnauthorized(res, error);
    return;
  }
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

function sendUnauthorized(res: Response, error: unknown): void {
  const message = error instanceof DomainError ? error.message : "Bearer token was rejected";
  res.status(401).json({ error: "unauthenticated", message });
}
