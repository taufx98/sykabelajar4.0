# Supabase2 Full Migration Runbook — 2026-09-03

Source project verified: `sykabelajarid` / `jrfogwueytiddnanetth`
Region: `ap-southeast-1`
Database: PostgreSQL 17.6.1.155

## What was verified in the source

- `auth.users`: 7
- `public.profiles`: 7
- `public.organizers`: 2
- `public.competitions`: 5
- `public.notifications`: 14
- `public.chat_threads`: 14
- `public.chat_messages`: 66
- `public.audit_logs`: 34
- `public.plan_catalog`: 3
- `public.plan_entitlements`: 32
- `public.organizer_members`: 3
- `public.organizer_plans`: 5
- `public.registrations`: 3
- `public.xp_ledger`: 4
- `public.edu_coin_ledger`: 4
- `public.daily_checkins`: 4
- `storage.buckets`: 0
- `storage.objects`: 0

The source currently has no Storage files or buckets to copy.

## Database migration

Supabase's current backup/restore guidance uses `supabase db dump` for `roles.sql`, `schema.sql`, and a data dump, followed by `psql` restore. The repository now contains `scripts/supabase-project-migration.sh` to perform this flow. It deliberately keeps database URLs and secrets outside Git.

From a machine with the Supabase CLI and `psql` installed:

```bash
export OLD_PROJECT_REF="jrfogwueytiddnanetth"
export NEW_PROJECT_REF="<SUPABASE2_PROJECT_REF>"
export OLD_DB_URL="<SOURCE_SESSION_POOLER_OR_DIRECT_CONNECTION_STRING>"
export NEW_DB_URL="<TARGET_SESSION_POOLER_OR_DIRECT_CONNECTION_STRING>"

bash scripts/supabase-project-migration.sh
```

The script creates:

- `roles.sql`
- `schema.sql`
- `data.sql`
- `history_schema.sql`
- `history_data.sql`
- `edge-functions.txt`

It then restores the database and verifies key row counts on Supabase2.

## Extensions, Realtime, and cron

After the main restore, run:

```bash
psql "$NEW_DB_URL" -f supabase/migration/supabase2-extensions-cron.sql
```

The source currently has these installed extensions:

- `pg_cron` 1.6.4
- `pg_stat_statements` 1.11
- `pgcrypto` 1.3
- `supabase_vault` 0.3.1
- `uuid-ossp` 1.1
- `plpgsql` 1.0

The source Realtime publication contains:

`ad_banners`, `chat_blocks`, `chat_messages`, `chat_threads`, `competitions`, `follows`, `notifications`, `orders`, `profiles`.

The source has two active hourly cron jobs:

- `SELECT public.verify_pending_referrals();`
- `SELECT public.fetch_and_save_supabase_logs();`

The supplied SQL recreates those jobs after the restore.

## Edge Functions

Verified active functions on the source:

1. `payment-webhook` — JWT verification OFF
2. `cloudinary-delete-asset` — JWT verification ON
3. `midtrans-create-payment` — JWT verification ON
4. `cloudinary-profile-upload` — JWT verification ON
5. `cloudinary-profile-upload-v2` — JWT verification ON
6. `cloudinary-delete-asset-v2` — JWT verification ON
7. `cloudinary-delete-profile` — JWT verification ON
8. `get-cloudinary-signature` — JWT verification ON
9. `cleanup-expired-chat-media` — JWT verification OFF

Supabase's current guidance is to download each function from the source and deploy it to the target. From the repository root:

```bash
mkdir -p /tmp/syka-edge-migration
cd /tmp/syka-edge-migration

supabase functions download payment-webhook --project-ref "$OLD_PROJECT_REF"
supabase functions download cloudinary-delete-asset --project-ref "$OLD_PROJECT_REF"
supabase functions download midtrans-create-payment --project-ref "$OLD_PROJECT_REF"
supabase functions download cloudinary-profile-upload --project-ref "$OLD_PROJECT_REF"
supabase functions download cloudinary-profile-upload-v2 --project-ref "$OLD_PROJECT_REF"
supabase functions download cloudinary-delete-asset-v2 --project-ref "$OLD_PROJECT_REF"
supabase functions download cloudinary-delete-profile --project-ref "$OLD_PROJECT_REF"
supabase functions download get-cloudinary-signature --project-ref "$OLD_PROJECT_REF"
supabase functions download cleanup-expired-chat-media --project-ref "$OLD_PROJECT_REF"
```

Then deploy each downloaded function to `NEW_PROJECT_REF` while preserving the source JWT mode. Do not commit function secrets to Git.

## Secrets and external integrations

The following are intentionally NOT copied into the repository or migration SQL:

- Supabase service-role/secret keys
- payment provider secrets
- `PAYMENT_WEBHOOK_SECRET`
- Midtrans server key / client secret values
- Cloudinary API secret values
- any other Edge Function environment secrets
- SMTP credentials
- OAuth provider client secrets
- JWT signing secrets / project API keys

Configure equivalent secrets in Supabase2 using new project credentials where appropriate. Do not reuse a source project's JWT signing secret unless you have a deliberate security reason.

The application also needs its frontend environment values changed to the new Supabase2 URL and publishable key after verification.

## Auth users

The database data dump includes the source `auth.users` rows according to Supabase's backup/restore flow, so the seven current accounts are part of the database migration. Existing access tokens will not remain valid against the new project; users should sign in again after the cutover.

OAuth/SMTP/provider configuration is separate from database contents and must be reconfigured in the Supabase2 dashboard.

## Storage

The source currently has zero buckets and zero objects, so there is no storage payload to migrate today. If storage is populated later, migrate the bucket configuration and objects separately; object bytes are not represented by PostgreSQL row data.

## Final verification on Supabase2

Run:

```sql
select count(*) from auth.users;
select count(*) from public.profiles;
select count(*) from public.organizers;
select count(*) from public.competitions;
select count(*) from public.notifications;
select count(*) from public.chat_messages;

select extname, extversion from pg_extension order by extname;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;

select jobid, schedule, command, active
from cron.job
order by jobid;
```

Expected key counts at the time of this snapshot are 7, 7, 2, 5, 14, and 66 respectively.

## Important: current Supabase security finding

The source advisor currently reports `private.organizer_access_codes` with RLS disabled. Do NOT automatically enable RLS during migration without matching policies; doing so without policies would block access and may break the organizer flow. This is a separate security remediation item and is intentionally not changed by the migration package.

## Production cutover

Only after all checks above pass:

1. Update the frontend's Supabase URL/publishable key to Supabase2.
2. Deploy the latest frontend build.
3. Reconfigure Edge Function URLs/webhooks to the Supabase2 project.
4. Reconfigure provider redirect URLs and OAuth settings where applicable.
5. Verify login, organizer, competition registration, payment, chat, certificates/QR verification, and admin functions.
6. Keep the old project available as rollback until the new project has been observed successfully.
