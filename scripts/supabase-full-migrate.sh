#!/usr/bin/env bash
set -Eeuo pipefail

# Full managed-Supabase database migration helper.
#
# Required environment variables:
#   OLD_DB_URL  = source Supabase Session Pooler/direct connection string
#   NEW_DB_URL  = target Supabase Session Pooler/direct connection string
#
# Optional:
#   BACKUP_DIR        = backup directory (default: ./supabase-backup-YYYYmmdd-HHMMSS)
#   SKIP_DUMP         = 1 to skip dump and restore an existing BACKUP_DIR
#   SKIP_RESTORE      = 1 to only create the dump
#
# This script deliberately keeps credentials in environment variables and
# never writes them into repository files.

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

need_cmd psql
need_cmd supabase

: "${OLD_DB_URL:?Set OLD_DB_URL to the source Supabase database connection string}"
: "${NEW_DB_URL:?Set NEW_DB_URL to the target Supabase database connection string}"

BACKUP_DIR="${BACKUP_DIR:-./supabase-backup-$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$BACKUP_DIR"

if [[ "${SKIP_DUMP:-0}" != "1" ]]; then
  echo "==> Exporting source Supabase project"
  echo "    Backup directory: $BACKUP_DIR"

  # Supabase's wrapper applies Supabase-specific filtering and is preferred
  # over a raw pg_dump for managed projects.
  supabase db dump --db-url "$OLD_DB_URL" \
    -f "$BACKUP_DIR/roles.sql" \
    --role-only

  supabase db dump --db-url "$OLD_DB_URL" \
    -f "$BACKUP_DIR/schema.sql"

  supabase db dump --db-url "$OLD_DB_URL" \
    -f "$BACKUP_DIR/data.sql" \
    --use-copy \
    --data-only \
    -x "storage.buckets_vectors" \
    -x "storage.vector_indexes"

  # Preserve CLI migration history separately so the new project can retain
  # the exact source migration ledger after schema/data restoration.
  supabase db dump --db-url "$OLD_DB_URL" \
    -f "$BACKUP_DIR/history_schema.sql" \
    --schema supabase_migrations

  supabase db dump --db-url "$OLD_DB_URL" \
    -f "$BACKUP_DIR/history_data.sql" \
    --use-copy \
    --data-only \
    --schema supabase_migrations

  # Auth/storage customizations are managed schemas. Capture their diff as an
  # explicit artifact instead of silently assuming the new project's internal
  # service schema is identical.
  if [[ -n "${OLD_PROJECT_REF:-}" ]]; then
    echo "==> Capturing auth/storage schema diff from linked source project"
    supabase link --project-ref "$OLD_PROJECT_REF" >/dev/null
    supabase db diff --linked --schema auth,storage \
      > "$BACKUP_DIR/auth-storage-custom.sql" || {
        echo "WARNING: auth/storage diff could not be generated. Continue only after checking whether the source uses custom auth/storage objects." >&2
        : > "$BACKUP_DIR/auth-storage-custom.sql"
      }
  else
    echo "NOTICE: OLD_PROJECT_REF not set; auth/storage custom diff was not generated."
    echo "        Set OLD_PROJECT_REF and rerun the dump step if the source has custom auth/storage objects."
    : > "$BACKUP_DIR/auth-storage-custom.sql"
  fi
fi

for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql; do
  [[ -s "$BACKUP_DIR/$f" ]] || {
    echo "ERROR: backup artifact missing or empty: $BACKUP_DIR/$f" >&2
    exit 1
  }
done

if [[ "${SKIP_RESTORE:-0}" != "1" ]]; then
  echo "==> Restoring into target Supabase"
  echo "    TARGET MUST BE A FRESH/EMPTY PROJECT FOR THIS FULL RESTORE."

  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$BACKUP_DIR/roles.sql" \
    --file "$BACKUP_DIR/schema.sql" \
    --command 'SET session_replication_role = replica' \
    --file "$BACKUP_DIR/data.sql" \
    --dbname "$NEW_DB_URL"

  # Restore the migration ledger only after schema/data restoration.
  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$BACKUP_DIR/history_schema.sql" \
    --file "$BACKUP_DIR/history_data.sql" \
    --dbname "$NEW_DB_URL"

  # Restore any custom auth/storage DDL captured from the old project.
  if [[ -s "$BACKUP_DIR/auth-storage-custom.sql" ]]; then
    echo "==> Applying captured auth/storage customizations"
    psql \
      --single-transaction \
      --variable ON_ERROR_STOP=1 \
      --file "$BACKUP_DIR/auth-storage-custom.sql" \
      --dbname "$NEW_DB_URL"
  fi
fi

echo "==> Verifying target"
psql "$NEW_DB_URL" --variable ON_ERROR_STOP=1 <<'SQL'
select current_database() as database_name;
select version() as postgres_version;
select count(*) as auth_users from auth.users;
select count(*) as public_profiles from public.profiles;
select count(*) as organizers from public.organizers;
select count(*) as competitions from public.competitions;
select count(*) as registrations from public.registrations;
select count(*) as chat_messages from public.chat_messages;
select count(*) as notifications from public.notifications;
select count(*) as audit_logs from public.audit_logs;
select count(*) as plans from public.organizer_plans;
select count(*) as plan_entitlements from public.plan_entitlements;
select count(*) as certificates from public.certificates;
select count(*) as organizer_serials from public.organizer_serials;
SQL

echo ""
echo "Migration completed. Backup artifacts are in: $BACKUP_DIR"
echo "Keep the backup directory outside source control; it can contain auth/user data."
