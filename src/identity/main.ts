import { readIdentityConfig } from "./config.js";
import { createIdentityApp } from "./app.js";
import { createSigningKeys } from "./tokens.js";
import { openDatabase } from "../db/client.js";
import { provisionOwnerMember } from "../db/store.js";

const config = readIdentityConfig();
const keys = createSigningKeys();
const { db, close } = openDatabase(config.databaseUrl);
const app = createIdentityApp({
  config,
  keys,
  provisionMember: (member) => provisionOwnerMember(db, member),
});
const server = app.listen(config.port, "0.0.0.0");

await new Promise<void>((resolve, reject) => {
  server.once("listening", () => resolve());
  server.once("error", reject);
});

console.log(`Northwharf Auth0 listening on ${config.port}`);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
  });
  await close();
}

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0), (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
});
process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0), (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
});
