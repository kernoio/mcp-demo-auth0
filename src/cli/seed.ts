import { readConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { seedDatabase } from "../db/seed.js";

const config = readConfig();
const { db, close } = openDatabase(config.databaseUrl);
try {
  await seedDatabase(db, config.ownerSubject);
} finally {
  await close();
}
