import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  path.join(
    here,
    "../../supabase/migrations/20261125103000_fix_admin_create_organizer_pgcrypto_search_path.sql",
  ),
  "utf8",
);

assert.match(migration, /BEGIN;[\s\S]*?COMMIT;/);
assert.match(migration, /public\.admin_create_organizer\(uuid,text,text\)/);
assert.match(migration, /bd5b5646fdf2bee263f18323480fa7c4/);
assert.match(migration, /'postgres'::regrole::oid/);
assert.match(migration, /p\.prosecdef/);
assert.match(migration, /ARRAY\['search_path=public, private'\]::text\[\]/);
assert.match(migration, /\{postgres=X\/postgres,authenticated=X\/postgres,service_role=X\/postgres\}/);
assert.match(migration, /extensions\.gen_random_bytes\(integer\)/);
assert.match(migration, /extensions\.crypt\(text,text\)/);
assert.match(migration, /extensions\.gen_salt\(text\)/);
assert.match(
  migration,
  /ALTER FUNCTION public\.admin_create_organizer\(uuid,text,text\)\s+SET search_path = public, private, extensions;/,
);
assert.match(migration, /ARRAY\['search_path=public, private, extensions'\]::text\[\]/);
assert.match(migration, /STAGE7_ADMIN_CREATE_ORGANIZER_SEARCH_PATH_OR_ACL_VERIFY_FAILED/);
assert.match(migration, /has_schema_privilege\('anon', 'extensions', 'CREATE'\)/);
assert.match(migration, /has_schema_privilege\('authenticated', 'extensions', 'CREATE'\)/);
assert.match(migration, /has_schema_privilege\('service_role', 'extensions', 'CREATE'\)/);

assert.doesNotMatch(
  migration,
  /CREATE\s+OR\s+REPLACE|\bGRANT\b|\bREVOKE\b|\bDROP\b/i,
  "the fix must only alter this function's search_path and must not replace its body or modify ACLs",
);

console.log("Stage 7 admin_create_organizer pgcrypto search_path contract passed.");
