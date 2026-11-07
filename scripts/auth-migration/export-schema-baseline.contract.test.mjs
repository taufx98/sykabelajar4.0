import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.join(here, 'export-schema-baseline.sh'), 'utf8');

assert.ok(script.includes('supabase db dump -f "$OUTPUT_DIR/schema.sql" --remote="$SUPABASE_DB_URL"'));
assert.ok(script.includes('SUPABASE_CLI_WORKDIR="${SUPABASE_CLI_WORKDIR:-$REPO_ROOT}"'));
assert.ok(script.includes('SCHEMA_BASELINE_OUTPUT_DIR'));
assert.ok(script.includes('PGPASSFILE="$OUTPUT_DIR/.schema-baseline.pgpass"'));
assert.ok(script.includes('source "$PG_ENV"'));
assert.ok(script.includes('stage3-baseline-metadata.sql'));
assert.ok(script.includes('production-catalog-metadata.json'));
assert.ok(script.includes('CATALOG_METADATA_SQL="$(cat "$REPO_ROOT/scripts/auth-migration/stage3-baseline-metadata.sql")"'));
assert.ok(script.includes('--command "$CATALOG_METADATA_SQL"'));
assert.ok(script.includes('Stage 3 production catalog metadata snapshot is empty'));
assert.ok(script.includes('production-catalog-metadata.json manifest.txt > SHA256SUMS'));
assert.doesNotMatch(script, /psql\s+["']?\$SUPABASE_DB_URL/);
assert.doesNotMatch(script, /supabase link|supabase login/);
assert.ok(script.includes('need_cmd node'));
assert.ok(script.includes('const directMatch = host === `db.${ref}.supabase.co`'));
assert.ok(script.includes('const poolerMatch = host.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`'));
assert.ok(script.includes('Connection string does not match SUPABASE_PROJECT_REF'));
assert.ok(script.includes('supabase db diff --use-migra --schema auth,storage --remote="$SUPABASE_DB_URL"'));
assert.doesNotMatch(script, /supabase db diff --to=remote/);
assert.ok(script.includes('select extname, extversion from pg_extension order by extname'));
assert.ok(script.includes('role-metadata.txt'));
assert.ok(script.includes('select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls from pg_roles'));
assert.ok(script.includes('select n.nspname, d.defaclobjtype, r.rolname'));
assert.ok(script.includes("printf '%s\\n'"));
assert.ok(script.includes('shasum -a 256 schema.sql auth-storage-custom.sql postgres-version.txt extensions.txt role-metadata.txt production-catalog-metadata.json manifest.txt > SHA256SUMS'));
assert.ok(script.includes('sha256sum schema.sql auth-storage-custom.sql postgres-version.txt extensions.txt role-metadata.txt production-catalog-metadata.json manifest.txt > SHA256SUMS'));
assert.doesNotMatch(script, /select[^\\n]*rolpassword/i);
assert.ok(script.includes('mktemp -d'));
assert.ok(script.includes('Refusing to write a schema dump inside the Git repository'));
assert.ok(script.includes("COPY[[:space:]].*[[:space:]]FROM stdin;"));
assert.doesNotMatch(script, /--data-only|--role-only|supabase db restore|supabase db push|supabase functions deploy/);
assert.equal(script.split(/\\r?\\n/).some((line) =>
  line.includes('psql ') && /(?:--file(?:=|\\s)|(?:^|\\s)-f(?:\\s|$))/.test(line)
), false, 'psql must never restore a SQL file');
assert.ok(script.includes('remote_restore_or_deploy=not-performed'));

console.log('Schema baseline exporter contract passed: schema-only, no data/roles export, no restore/deploy.');
