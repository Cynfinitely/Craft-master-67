import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import path from "node:path";
import * as schema from "./schema";

export const DB_PATH = path.join(process.cwd(), "data", "poe2.db");

let _client: Client | null = null;
let _db: LibSQLDatabase<typeof schema> | null = null;

export function getClient(): Client {
  if (!_client) {
    _client = createClient({ url: `file:${DB_PATH}` });
  }
  return _client;
}

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

export { schema };
