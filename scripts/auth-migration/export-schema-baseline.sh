#!/usr/bin/env bash
set -Eeuo pipefail

# Export schema-only metadata for a local SYKABELAJAR auth-migration baseline.
# This helper is deliberately read-only against the remote project.
# It does not export application rows, custom role definitions, or credentials.
# It does not restore, apply, deploy, pause, or modify any remote resource.

die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }

need_cmd supabase
need_cmd docker
need_cmd psql
need_cmd git
need_cmd mktemp
need_cmd node

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF to the existing project ref}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL in your local shell; never commit it or paste it into chat}"

[[ "$SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || die 'SUPABASE_PROJECT_REF must be the 20-character project ref.'
[[ "$SUPABASE_DB_URL" == postgres://* || "$SUPABASE_DB_URL" == postgresql://* ]] || die 'SUPABASE_DB_URL must be a PostgreSQL connection string.'

# Prevent mixed-project artifacts: the schema dump and Auth/Storage diff must
# refer to the same Supabase project. Accept direct DB hosts and session pooler.
node --input-type=module <<'NODE'
const ref = process.env.SUPABASE_PROJECT_REF;
const raw = process.env.SUPABASE_DB_URL;
let parsed;
try {
  parsed = new URL(raw);
} catch {
  console.error("SUPABASE_DB_URL is not a valid PostgreSQL URL.");
  process.exit(1);
}
const host = parsed.hostname.toLowerCase();
const username = decodeURIComponent(parsed.username);
const directMatch = host === `db.${ref}.supabase.co`;
const poolerMatch = host.endsWith(".pooler.supabase.com") && username === `postgres.${ref}`;
if (!directMatch && !poolerMatch) {
  console.error("Connection string does not match SUPABASE_PROJECT_REF. Use the direct host db.<project-ref>.supabase.co or the session pooler with username postgres.<project-ref>. No export was run.");
  process.exit(1);
}
NODE

CLI_VERSION="$(supabase --version 2>/dev/null || true)"
[[ "$CLI_VERSION" == *"3.0.0"* ]] || die "Expected Supabase CLI 3.0.0 for a reproducible export; found: ${CLI_VERSION:-unknown}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
OUTPUT_ROOT="${TMPDIR:-/tmp}"
OUTPUT_DIR="$(mktemp -d "${OUTPUT_ROOT%/}/sykabelajar-auth-schema-baseline.XXXXXX")"
case "$OUTPUT_DIR/" in
  "$REPO_ROOT/"*) die 'Refusing to write a schema dump inside the Git repository.' ;;
esac
chmod 700 "$OUTPUT_DIR"

printf 'Output folder: %s\n' "$OUTPUT_DIR"
printf 'Linking the existing Supabase project in local CLI metadata...\n'
supabase link --project-ref "$SUPABASE_PROJECT_REF"

printf 'Exporting schema-only custom database objects...\n'
# Default `db dump` exports schema only; it intentionally omits data and custom roles.
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUTPUT_DIR/schema.sql"

printf 'Capturing custom Auth/Storage DDL separately...\n'
# `db diff` is a read-only comparison; output is saved locally, not applied.
supabase db diff --linked --schema auth,storage > "$OUTPUT_DIR/auth-storage-custom.sql"

printf 'Recording PostgreSQL version and installed extension versions...\n'
psql "$SUPABASE_DB_URL" -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
  --command 'select version();' > "$OUTPUT_DIR/postgres-version.txt"
psql "$SUPABASE_DB_URL" -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
  --command 'select extname, extversion from pg_extension order by extname;' > "$OUTPUT_DIR/extensions.txt"

# Record role attributes and default ACL metadata without ever selecting
# rolpassword or exporting role definitions. Platform roles are recreated by
# the disposable local Supabase stack; this file is a comparison checklist.
{
  printf '%s\n' '# Roles (no password hashes or role DDL)'
  psql "$SUPABASE_DB_URL" -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
    --command "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls from pg_roles where rolname !~ '^pg_' order by rolname;"
  printf '%s\n' '# Default ACLs (object types: r=relations, S=sequences, f=functions)'
  psql "$SUPABASE_DB_URL" -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
    --command "select n.nspname, d.defaclobjtype, r.rolname, coalesce(pg_catalog.array_to_string(d.defaclacl, ','), '') from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace join pg_roles r on r.oid=d.defaclrole order by n.nspname,d.defaclobjtype,r.rolname;"
} > "$OUTPUT_DIR/role-metadata.txt"

[[ -s "$OUTPUT_DIR/schema.sql" ]] || die 'The schema dump is empty.'
[[ -f "$OUTPUT_DIR/auth-storage-custom.sql" ]] || die 'The Auth/Storage DDL diff was not created.'
[[ -s "$OUTPUT_DIR/role-metadata.txt" ]] || die 'The password-free role/default-ACL metadata file is empty.'

# A schema-only dump must not contain pg_dump COPY data blocks.
if grep -Eq '^[[:space:]]*COPY[[:space:]].*[[:space:]]FROM stdin;' "$OUTPUT_DIR/schema.sql"; then
  die 'The schema dump unexpectedly contains a COPY data block; do not use this artifact.'
fi

cat > "$OUTPUT_DIR/manifest.txt" <<EOF
project_ref=$SUPABASE_PROJECT_REF
supabase_cli=$CLI_VERSION
generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mode=schema-only
contains_application_rows=false
contains_custom_role_dump=false
remote_restore_or_deploy=not-performed
EOF

chmod 600 "$OUTPUT_DIR"/*
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum schema.sql auth-storage-custom.sql postgres-version.txt extensions.txt role-metadata.txt manifest.txt > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && shasum -a 256 schema.sql auth-storage-custom.sql postgres-version.txt extensions.txt role-metadata.txt manifest.txt > SHA256SUMS)
else
  die 'Neither sha256sum nor shasum is available to checksum the export.'
fi

printf '\nSchema-only export completed. No remote DDL/DML or deployment was executed.\n'
printf 'Local artifacts: %s\n' "$OUTPUT_DIR"
printf 'Review schema.sql and auth-storage-custom.sql before using them in any local baseline.\n'