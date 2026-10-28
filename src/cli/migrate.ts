import { readConfig } from "../config.js";
import { applyMigrations } from "../db/migrate.js";
import { openDatabase } from "../db/client.js";

const config = readConfig();
const { db, close } = openDatabase(config.databaseUrl);
try {
  await applyMigrations(db);
} finally {
  await close();
}
