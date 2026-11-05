import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.join(here, 'export-schema-baseline.sh'), 'utf8');

assert.ok(script.includes('supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUTPUT_DIR/schema.sql"'));
assert.ok(script.includes('need_cmd node'));
assert.ok(script.includes('const directMatch = host === `db.${ref}.supabase.co`'));
assert.ok(script.includes('const poolerMatch = host.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`'));
assert.ok(script.includes('Connection string does not match SUPABASE_PROJECT_REF'));
assert.ok(script.includes('supabase db diff --linked --schema auth,storage'));
assert.ok(script.includes('select extname, extversion from pg_extension order by extname'));
assert.ok(script.includes('mktemp -d'));
assert.ok(script.includes('Refusing to write a schema dump inside the Git repository'));
assert.ok(script.includes("COPY[[:space:]].*[[:space:]]FROM stdin;"));
assert.doesNotMatch(script, /--data-only|--role-only|supabase db restore|supabase db push|supabase functions deploy/);
assert.equal(script.split(/\\r?\\n/).some((line) =>
  line.includes('psql ') && /(?:--file(?:=|\\s)|(?:^|\\s)-f(?:\\s|$))/.test(line)
), false, 'psql must never restore a SQL file');
assert.ok(script.includes('remote_restore_or_deploy=not-performed'));

console.log('Schema baseline exporter contract passed: schema-only, no data/roles export, no restore/deploy.');
