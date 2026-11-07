#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF in your local shell.}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL in your local shell; never paste it into chat.}"
command -v psql >/dev/null 2>&1 || { echo "psql is required." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }

EXPECTED_PROJECT_REF="mvdczyitbkxkldjughor"
EXPECTED_FK_COUNT=69
if [[ "$SUPABASE_PROJECT_REF" != "$EXPECTED_PROJECT_REF" ]]; then
  echo "Blocked: SUPABASE_PROJECT_REF does not match the audited production project." >&2
  exit 1
fi

if [[ $# -ne 1 || "$1" != /* ]]; then
  echo "Usage: SUPABASE_PROJECT_REF=... SUPABASE_DB_URL=... $0 /absolute/output/directory-outside-repo" >&2
  exit 2
fi

OUT_DIR="$(mkdir -p "$1" && cd "$1" && pwd -P)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
case "$OUT_DIR/" in
  "$REPO_ROOT/"*)
    echo "Blocked: output directory must be outside the Git repository." >&2
    exit 1
    ;;
esac

umask 077
PGPASSFILE="$OUT_DIR/.auth-fk-catalog.pgpass"
PG_ENV="$OUT_DIR/.auth-fk-catalog.pg-env"
RAW_JSON="$OUT_DIR/.auth-fk-catalog.raw.json"
FINAL_JSON="$OUT_DIR/live-auth-users-fk-catalog.json"
SQL_HASH="$OUT_DIR/live-auth-users-fk-catalog.sha256"
trap 'rm -f "$PGPASSFILE" "$PG_ENV" "$RAW_JSON"' EXIT
rm -f "$FINAL_JSON" "$SQL_HASH"

# Validate the target and write a mode-0600 libpq password file. The URI is
# consumed from the process environment and is never put on the command line.
node --input-type=module - "$PGPASSFILE" "$PG_ENV" <<'NODE'
import { writeFileSync } from "node:fs";

const [passFile, envFile] = process.argv.slice(2);
const raw = process.env.SUPABASE_DB_URL ?? "";
const ref = process.env.SUPABASE_PROJECT_REF ?? "";
const url = new URL(raw);
const directHost = url.hostname === "db." + ref + ".supabase.co";
const username = decodeURIComponent(url.username);
const poolerHost = url.hostname.endsWith(".pooler.supabase.com") &&
  username === "postgres." + ref;
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  throw new Error("Database URI must use PostgreSQL protocol.");
}
if (!directHost && !poolerHost) {
  throw new Error("Database URI host/username does not match SUPABASE_PROJECT_REF.");
}
if (url.searchParams.get("sslmode") && url.searchParams.get("sslmode") !== "require" &&
    url.searchParams.get("sslmode") !== "verify-ca" &&
    url.searchParams.get("sslmode") !== "verify-full") {
  throw new Error("TLS is required for the production database connection.");
}
const host = url.hostname;
const port = url.port || "5432";
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const password = decodeURIComponent(url.password);
if (!database || !username || !password || /[\r\n]/.test(password)) {
  throw new Error("Database URI is incomplete or contains invalid password characters.");
}
const escapePass = (value) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
writeFileSync(passFile, [host, port, database, username, password].map(escapePass).join(":") + "\n", { mode: 0o600 });
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(envFile, [
  "export PGHOST=" + shellQuote(host),
  "export PGPORT=" + shellQuote(port),
  "export PGDATABASE=" + shellQuote(database),
  "export PGUSER=" + shellQuote(username),
  "export PGSSLMODE=require",
  "export PGPASSFILE=" + shellQuote(passFile),
].join("\n") + "\n", { mode: 0o600 });
NODE
source "$PG_ENV"

SQL=$(cat <<'SQL'
BEGIN READ ONLY;
SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'name', c.conname,
      'source_schema', source_ns.nspname,
      'source_table', source_table.relname,
      'source_columns', ARRAY(
        SELECT source_att.attname
        FROM unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ord)
        JOIN pg_attribute AS source_att
          ON source_att.attrelid = source_table.oid
         AND source_att.attnum = key_column.attnum
        ORDER BY key_column.ord
      ),
      'target_schema', target_ns.nspname,
      'target_table', target_table.relname,
      'target_columns', ARRAY(
        SELECT target_att.attname
        FROM unnest(c.confkey) WITH ORDINALITY AS key_column(attnum, ord)
        JOIN pg_attribute AS target_att
          ON target_att.attrelid = target_table.oid
         AND target_att.attnum = key_column.attnum
        ORDER BY key_column.ord
      ),
      'match_type', CASE c.confmatchtype
        WHEN 's' THEN 'SIMPLE' WHEN 'f' THEN 'FULL' WHEN 'p' THEN 'PARTIAL' END,
      'on_update', CASE c.confupdtype
        WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
      'on_delete', CASE c.confdeltype
        WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
      'deferrable', c.condeferrable,
      'initially_deferred', c.condeferred,
      'validated', c.convalidated
    )
    ORDER BY source_ns.nspname, source_table.relname, c.conname
  ),
  '[]'::jsonb
)::text
FROM pg_constraint AS c
JOIN pg_class AS source_table ON source_table.oid = c.conrelid
JOIN pg_namespace AS source_ns ON source_ns.oid = source_table.relnamespace
JOIN pg_class AS target_table ON target_table.oid = c.confrelid
JOIN pg_namespace AS target_ns ON target_ns.oid = target_table.relnamespace
WHERE c.contype = 'f'
  AND target_ns.nspname = 'auth'
  AND target_table.relname = 'users'
  AND source_ns.nspname IN ('public', 'private');
COMMIT;
SQL
)

psql -X --set=ON_ERROR_STOP=1 --no-align --tuples-only --quiet --command "$SQL" > "$RAW_JSON"

node --input-type=module - "$RAW_JSON" "$FINAL_JSON" "$SUPABASE_PROJECT_REF" "$EXPECTED_FK_COUNT" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [rawPath, finalPath, ref, expectedCount] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(rawPath, "utf8").trim());
const expected = Number(expectedCount);
if (!Array.isArray(raw)) throw new Error("Catalog query did not return a JSON array.");
if (raw.length !== expected) {
  throw new Error("Live FK count drift: expected " + expected + ", found " + raw.length + ". Stop and review before generating a plan.");
}
const sourceTables = new Set();
for (const fk of raw) {
  if (fk.target_schema !== "auth" || fk.target_table !== "users") {
    throw new Error("Unexpected FK target; refusing to write catalog.");
  }
  if (!["public", "private"].includes(fk.source_schema)) {
    throw new Error("Unexpected source schema; refusing to write catalog.");
  }
  if (!Array.isArray(fk.source_columns) || fk.source_columns.length !== 1 ||
      !Array.isArray(fk.target_columns) || fk.target_columns.length !== 1 ||
      fk.target_columns[0] !== "id") {
    throw new Error("Composite or unsupported FK detected; manual review required.");
  }
  if (fk.validated !== true || fk.deferrable !== false || fk.initially_deferred !== false) {
    throw new Error("Unexpected validation/deferrability state; manual review required.");
  }
  sourceTables.add(fk.source_schema + "." + fk.source_table);
}
if (sourceTables.size !== 62) {
  throw new Error("Source table count drift: expected 62, found " + sourceTables.size + ".");
}
const payload = {
  project_ref: ref,
  generated_at: new Date().toISOString(),
  source: "read-only pg_catalog snapshot; no application rows exported",
  foreign_keys: raw,
};
const body = JSON.stringify(payload, null, 2) + "\n";
writeFileSync(finalPath, body, { flag: "wx", mode: 0o600 });
const digest = createHash("sha256").update(body).digest("hex");
writeFileSync(finalPath.replace(/\.json$/, ".sha256"), digest + "  live-auth-users-fk-catalog.json\n", { flag: "wx", mode: 0o600 });
process.stdout.write(
  "Captured " + raw.length + " reviewed-shape auth.users foreign keys across " +
  sourceTables.size + " source tables.\n" +
  "Wrote mode-0600 catalog and SHA-256 to the output directory.\n" +
  "No DDL/DML was executed; query ran inside BEGIN READ ONLY.\n"
);
NODE

node "$REPO_ROOT/scripts/auth-migration/generate-app-users-fk-plan.mjs" \
  --catalog "$FINAL_JSON" \
  --out-dir "$OUT_DIR/fk-plan"

echo "Review bundle directory: $OUT_DIR"
echo "Do not execute the generated SQL. It is a review-only plan and requires a full schema-only restore, production-shaped regression, and explicit production approval."
