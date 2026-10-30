import { createBearerAuthenticator } from "./auth/verify.js";
import { readConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { seedDatabase } from "./db/seed.js";
import { createApp } from "./http/app.js";

const config = readConfig();
const { db, close } = openDatabase(config.databaseUrl);

await applyMigrations(db);
await seedDatabase(db, config.ownerSubject);

const app = createApp(db, createBearerAuthenticator(config), {
  resource: config.authAudience,
  authorizationServer: config.authIssuer,
});
const server = app.listen(config.port, "0.0.0.0");

await new Promise<void>((resolve, reject) => {
  server.once("listening", () => resolve());
  server.once("error", reject);
});

console.log(`Northwharf listening on ${config.port}`);

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
