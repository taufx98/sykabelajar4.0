# SykaBelajar 4.0 — Full Supabase Migration

Tanggal audit: 2026-09-02
Source project ref: `jrfogwueytiddnanetth`

## Tujuan

Dokumen ini menjadi prosedur resmi untuk memindahkan database Supabase lama ke project Supabase baru tanpa mengandalkan migration history lokal saja.

Snapshot database source yang diaudit saat dokumen ini dibuat memiliki:

- 7 `auth.users`
- 7 `auth.identities`
- 70+ tabel custom di schema `public` dan `private`
- custom enum types
- database functions/RPC
- RLS policies
- triggers
- views
- indexes/constraints
- data produksi pada beberapa tabel (profil, organizer, organizer membership/plan, competition, registration, chat, notification, audit, leaderboard/currency/check-in data)

Karena project lama sudah memiliki migration history yang panjang dan beberapa perubahan dibuat di dashboard/SQL Editor, **jangan menganggap folder `supabase/migrations` saja sebagai backup penuh**.

## Cara migrasi

Script canonical ada di:

```text
scripts/supabase-full-migrate.sh
```

Script memakai `supabase db dump` untuk mengambil dump yang difilter khusus untuk managed Supabase, kemudian `psql` untuk restore ke project baru.

### 1. Prasyarat

Install:

```bash
# Supabase CLI
# PostgreSQL client / psql
```

Docker diperlukan oleh Supabase CLI untuk operasi dump.

### 2. Ambil connection string kedua project

Gunakan **Connect → Session pooler** pada project lama dan project baru. Jangan commit connection string atau password ke Git.

Set environment:

```bash
export OLD_DB_URL='postgresql://...'
export NEW_DB_URL='postgresql://...'
export OLD_PROJECT_REF='jrfogwueytiddnanetth'
```

### 3. Jalankan full migration

```bash
bash scripts/supabase-full-migrate.sh
```

Script akan membuat folder seperti:

```text
supabase-backup-20260902-173000/
├── roles.sql
├── schema.sql
├── data.sql
├── history_schema.sql
├── history_data.sql
└── auth-storage-custom.sql
```

Folder backup dapat berisi data Auth dan data pengguna. Jangan masukkan ke Git.

### 4. Restore target

Script menjalankan restore ke `NEW_DB_URL`. Target sebaiknya merupakan project baru/fresh agar tidak terjadi benturan objek.

Restore memakai:

```text
roles.sql
schema.sql
data.sql
history_schema.sql
history_data.sql
auth-storage-custom.sql
```

Data restore dijalankan dengan `session_replication_role = replica` sesuai prosedur backup/restore Supabase untuk menghindari trigger menghasilkan efek samping selama bulk import.

## Apa yang berpindah

Database dump mencakup struktur/data database termasuk tabel custom, function, trigger, view, RLS, dan data `auth.users` menurut prosedur backup/restore Supabase.

Migration history `supabase_migrations` disimpan terpisah agar target dapat mempertahankan ledger migration source.

## Apa yang tidak boleh dianggap otomatis berpindah

### Edge Functions

Edge Functions harus dideploy ke project baru dari source code `supabase/functions` atau di-download dari project lama lalu dideploy ulang.

### Storage objects

File fisik di Storage bukan sekadar baris metadata Postgres. Bucket/object perlu dipindahkan terpisah.

### Project/API/Auth configuration

Project URL, publishable/anon key, JWT configuration, OAuth provider settings, SMTP, webhook configuration, custom domain, dan secrets harus dikonfigurasi untuk project baru.

### Realtime publications

Pastikan tabel yang memang membutuhkan Realtime diaktifkan kembali pada project baru.

## Catatan keamanan source lama

Audit live menemukan `private.organizer_access_codes` masih memiliki RLS disabled. Jangan menggunakan database migration sebagai alasan untuk membuka ulang tabel itu. Pada target baru, security posture harus diverifikasi sebelum aplikasi diarahkan ke project baru.

Audit juga menemukan beberapa `SECURITY DEFINER` function yang executable oleh authenticated/anon. Jangan mengubah privilege hanya karena migrasi; perubahan keamanan harus dilakukan sebagai tahap terpisah dan diuji.

## Verifikasi pasca-restore

Setelah script selesai, cocokkan minimal:

```sql
select count(*) from auth.users;
select count(*) from public.profiles;
select count(*) from public.organizers;
select count(*) from public.competitions;
select count(*) from public.registrations;
select count(*) from public.chat_threads;
select count(*) from public.chat_messages;
select count(*) from public.notifications;
select count(*) from public.audit_logs;
select count(*) from public.organizer_plans;
select count(*) from public.plan_entitlements;
select count(*) from public.certificates;
select count(*) from public.organizer_serials;
```

Kemudian verifikasi function/RPC, RLS, trigger, view, extension, dan Realtime.

## Prinsip cutover

1. Source menjadi snapshot/maintenance window saat final cutover agar data tidak berubah selama dump final.
2. Restore ke project baru.
3. Jalankan verifikasi row counts dan smoke test aplikasi.
4. Ubah env frontend ke URL + publishable key project baru.
5. Deploy frontend.
6. Setelah stabil, project lama dapat dipertahankan sebagai fallback sampai benar-benar tidak dibutuhkan.

Jangan melakukan dua database aktif dengan write traffic secara bersamaan setelah cutover karena dapat membuat split-brain data.
