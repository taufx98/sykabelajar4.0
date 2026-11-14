import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getMissingBetterAuthTables } from "../src/schema-contract.mjs";
import { stripRegistrationColumnsFromUserBaseline } from "../src/d1-schema-baseline.mjs";

const baseUrl = process.env.AUTH_WORKER_BASE_URL ?? "http://127.0.0.1:8787";
const token = process.env.D1_SCHEMA_BOOTSTRAP_TOKEN;

if (!token || token.length < 32) {
  throw new Error("D1_SCHEMA_BOOTSTRAP_TOKEN must be set to a random value of at least 32 characters.");
}

const response = await fetch(new URL("/_internal/schema-migrate", baseUrl), {
  method: "POST",
  headers: {
    Authorization: "Bearer " + token,
  },
});

const payload = await response.json();
if (!response.ok || payload.ok !== true || !Array.isArray(payload.ddl)) {
  throw new Error("D1 schema generation failed with HTTP " + response.status + ": " + JSON.stringify(payload));
}

const tableNames = payload.table_names ?? [];
const missing = getMissingBetterAuthTables(tableNames);

if (missing.length > 0) {
  throw new Error(
    "Generated Better Auth schema is incomplete. Missing models: " +
    missing.join(", ") +
    ". Actual D1 tables: " +
    tableNames.join(", "),
  );
}

const statements = payload.ddl
  .map((item) => String(item.sql ?? "").trim())
  .filter(Boolean)
  // 0001 is already applied remotely. Keep it as the immutable core baseline;
  // registration-only user columns are introduced by additive migration 0004.
  .map((sql) => stripRegistrationColumnsFromUserBaseline(sql))
  .map((sql) => sql
    .replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE (UNIQUE )?INDEX\s+/i, (_match, unique) => "CREATE " + (unique ?? "") + "INDEX IF NOT EXISTS "));

const output = [
  "-- Generated from Better Auth getMigrations() against a disposable local Cloudflare D1 binding.",
  "-- Review this schema before applying it to any shared environment.",
  "",
  ...statements.map((sql) => sql.endsWith(";") ? sql : sql + ";"),
  "",
].join("\n");

const target = resolve("migrations/0001_better_auth.sql");
await writeFile(target, output, { encoding: "utf8" });

console.log("Generated Better Auth D1 migration:", target);
console.log("Tables:", tableNames.join(", "));
console.log("DDL statements:", statements.length);
