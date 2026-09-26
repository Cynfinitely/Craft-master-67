import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import path from "node:path";
import * as schema from "./schema";

export const DB_PATH = path.join(process.cwd(), "data", "poe2.db");

let _client: Client | null = null;
let _db: LibSQLDatabase<typeof schema> | null = null;

/** True when the app is pointed at hosted libSQL (Turso) instead of the local file. */
export function isRemoteDb(): boolean {
  return Boolean(process.env.LIBSQL_URL);
}

export function getClient(): Client {
  if (!_client) {
    const url = process.env.LIBSQL_URL;
    if (url) {
      _client = createClient({
        url,
        authToken: process.env.LIBSQL_AUTH_TOKEN,
      });
    } else {
      _client = createClient({ url: `file:${process.env.DB_FILE || DB_PATH}` });
    }
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
