#!/usr/bin/env bash
set -euo pipefail

# Full Supabase platform-to-platform database migration helper.
# Secrets are read from environment variables and are never written to the repo.
# Source/target projects must already exist.

: "${OLD_PROJECT_REF:?Set OLD_PROJECT_REF, e.g. jrfogwueytiddnanetth}"
: "${NEW_PROJECT_REF:?Set NEW_PROJECT_REF for Supabase2}"
: "${OLD_DB_URL:?Set OLD_DB_URL to the source project connection string}"
: "${NEW_DB_URL:?Set NEW_DB_URL to the target project connection string}"

command -v supabase >/dev/null || { echo 'supabase CLI is required.' >&2; exit 1; }
command -v psql >/dev/null || { echo 'psql is required.' >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${MIGRATION_OUT_DIR:-$ROOT_DIR/supabase2-migration}"
mkdir -p "$OUT_DIR/functions"

printf '\n== 1/6 Backup source database ==\n'
supabase db dump --db-url "$OLD_DB_URL" -f "$OUT_DIR/roles.sql" --role-only
supabase db dump --db-url "$OLD_DB_URL" -f "$OUT_DIR/schema.sql"
supabase db dump --db-url "$OLD_DB_URL" -f "$OUT_DIR/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

printf '\n== 2/6 Preserve Supabase migration history ==\n'
supabase db dump --db-url "$OLD_DB_URL" -f "$OUT_DIR/history_schema.sql" --schema supabase_migrations
supabase db dump --db-url "$OLD_DB_URL" -f "$OUT_DIR/history_data.sql" --use-copy --data-only --schema supabase_migrations

printf '\n== 3/6 Restore database to Supabase2 ==\n'
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$OUT_DIR/roles.sql" \
  --file "$OUT_DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$OUT_DIR/data.sql" \
  --dbname "$NEW_DB_URL"

printf '\n== 4/6 Restore migration history ==\n'
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$OUT_DIR/history_schema.sql" \
  --file "$OUT_DIR/history_data.sql" \
  --dbname "$NEW_DB_URL"

printf '\n== 5/6 Export active Edge Functions from source ==\n'
printf '%s\n' \
  payment-webhook \
  cloudinary-delete-asset \
  midtrans-create-payment \
  cloudinary-profile-upload \
  cloudinary-profile-upload-v2 \
  cloudinary-delete-asset-v2 \
  cloudinary-delete-profile \
  get-cloudinary-signature \
  cleanup-expired-chat-media \
  > "$OUT_DIR/edge-functions.txt"

cat <<'NOTE' >&2
Edge Functions are intentionally not fetched by this shell helper because the CLI download format can change between versions.
Run the documented download commands from docs/SUPABASE2-MIGRATION-2026-09-03.md, then deploy them to Supabase2.
NOTE

printf '\n== 6/6 Verify key database state ==\n'
psql "$NEW_DB_URL" <<'SQL'
SELECT 'auth.users' AS table_name, count(*) AS row_count FROM auth.users
UNION ALL
SELECT 'public.profiles', count(*) FROM public.profiles
UNION ALL
SELECT 'public.organizers', count(*) FROM public.organizers
UNION ALL
SELECT 'public.competitions', count(*) FROM public.competitions
UNION ALL
SELECT 'public.notifications', count(*) FROM public.notifications
UNION ALL
SELECT 'public.chat_messages', count(*) FROM public.chat_messages;
SQL

printf '\nMigration artifacts written to: %s\n' "$OUT_DIR"
printf 'Review the report before switching production env vars.\n'
