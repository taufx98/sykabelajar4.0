import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.join(here, 'export-schema-baseline.sh'), 'utf8');

assert.match(script, /supabase db dump --db-url "\$SUPABASE_DB_URL" -f "\$OUTPUT_DIR\/schema\.sql"/);
assert.match(script, /supabase db diff --linked --schema auth,storage/);
assert.match(script, /select extname, extversion from pg_extension order by extname/);
assert.match(script, /mktemp -d/);
assert.match(script, /Refusing to write a schema dump inside the Git repository/);
assert.match(script, /COPY\\\[[:space:]\\\]/);
assert.doesNotMatch(script, /--data-only|--role-only|supabase db restore|supabase db push|supabase functions deploy/);
assert.doesNotMatch(script, /psql[\\s\\\\]+--file|psql[\\s\\\\]+-f/);
assert.match(script, /remote_restore_or_deploy=not-performed/);

console.log('Schema baseline exporter contract passed: schema-only, no data/roles export, no restore/deploy.');
