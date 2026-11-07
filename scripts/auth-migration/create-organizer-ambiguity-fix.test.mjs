import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  path.join(here, "../../supabase/migrations/20261107000100_fix_create_organizer_plpgsql_output_parameter_ambiguity.sql"),
  "utf8",
);

assert.match(sql,/CREATE OR REPLACE FUNCTION public\.create_organizer\(p_name text, p_slug text\)/);
assert.match(sql,/RETURNS TABLE\(id uuid, name text, slug text, access_code text\)/);
assert.match(sql,/FROM auth\.users AS au\s+WHERE au\.id = v_uid/);
assert.doesNotMatch(sql,/FROM auth\.users\s+WHERE id\s*=\s*v_uid/i);
assert.match(sql,/plpgsql\.variable_conflict setting is "error"/);
assert.match(sql,/EMAIL_VERIFICATION_REQUIRED/);
assert.match(sql,/PHONE_VERIFICATION_REQUIRED/);
assert.match(sql,/ORGANIZER_ROLE_REQUIRED/);
assert.match(sql,/ORGANIZER_LIMIT_REACHED/);
assert.match(sql,/FREE_ORGANIZER_ALREADY_CLAIMED/);
assert.match(sql,/extensions\.digest\(v_phone, 'sha256'\)/);
assert.match(sql,/extensions\.crypt\(v_code, extensions\.gen_salt\('bf', 10\)\)/);
assert.match(sql,/INSERT INTO public\.organizer_members/);
assert.match(sql,/INSERT INTO public\.organizer_plans/);
assert.match(sql,/INSERT INTO private\.organizer_free_identity_claims/);
assert.match(sql,/RETURN QUERY\s+SELECT o\.id, o\.name, o\.slug, v_code/);

console.log("create_organizer output-parameter ambiguity fix contract passed; verification and business invariants are retained.");
