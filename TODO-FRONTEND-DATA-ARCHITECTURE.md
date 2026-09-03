# 📝 TODO LIST: OPTIMASI ARSITEKTUR DATA FRONTEND

> **MARKER WAJIB ROADMAP** — Jangan menganggap fase/item selesai hanya karena fondasinya sudah tersedia. Checkbox hanya dicentang setelah implementasi dan verifikasi aktual.
>
> Standar arsitektur wajib untuk fitur baru maupun refactor fitur lama:
> **Local cache + Realtime + selective sync + RLS/backend authoritative**.

## 📦 FASE 1: FONDASI LOCAL CACHE LAYER
- [x] Implementasi mekanisme Fresh/Stale (Stale-While-Revalidate)
- [x] Tambahkan dukungan TTL (Time-to-Live) pada cache
- [x] Buat skema Versioning data untuk mitigasi perubahan struktur DB
- [x] Terapkan Per-User Key untuk isolasi data antar akun
- [x] Buat fungsi Auto-Clear cache saat user logout / ganti akun
- [x] Pastikan prinsip cache hanya untuk 'fast render', bukan source of truth

## 🔍 FASE 2: AUDIT & PEMETAAN SUPABASE
- [x] Audit halaman: Home / Competition — shared/public cache; Realtime competition/banner; sync hanya resource berubah; backend wajib untuk aksi registration/eligibility.
- [x] Audit halaman: Leaderboard — public cache TTL; Realtime leaderboard event masih perlu dikonsolidasikan; backend tetap authoritative untuk ranking.
- [x] Audit halaman: Profile — per-user cache untuk fast render; Realtime profile signal; permission/role/verification tetap backend.
- [x] Audit halaman: Awards — per-user cache + SWR; sertifikat/verification tetap backend-authoritative.
- [x] Audit halaman: Notifications — per-user cache + SWR; Realtime notification insert/read; backend authoritative untuk status read.
- [x] Audit halaman: Orders — daftar metadata boleh cache, tetapi status pembayaran/payment proof wajib live backend; aksi order melalui RPC/RLS.
- [x] Audit halaman: Feed — public cache TTL; Realtime `posts` belum menjadi signal global sehingga selective sync penuh masih pending.
- [x] Audit halaman: Organizer — per-user/per-organizer cache untuk daftar workspace dan UI state; membership/entitlement/access code/plan tetap backend-authoritative; Realtime organizer signal masih perlu dikonsolidasikan.
- [x] Audit halaman: Admin — default no-cache untuk payment, role, permission, premium, fulfillment, moderation, and other sensitive transactional state; cache hanya read-only UI/list yang jelas aman; semua aksi tetap RPC/RLS/backend.

*Catatan audit: untuk setiap fitur sudah ditentukan (1) tipe cache, (2) realtime event/signal yang tersedia, (3) pola selective sync yang dibutuhkan, (4) kondisi wajib query backend.*

## 🔄 FASE 3: STANDARDISASI POLA ALUR DATA
- [x] Refaktor alur: Ambil dari Local Cache -> Render Cepat
- [x] Hubungkan ke Realtime Change Signal
- [ ] Implementasi fungsi Selective Sync (hanya update data yg berubah)
- [x] Pastikan Backend / RLS selalu menjadi otoritas final data

## 💬 FASE 4: OPTIMASI CHAT & REKONSILIASI KONEKSI
- [x] Hapus double-subscription / query antara AppLayout & Mobile Navigation
- [ ] Bersihkan redundansi di Halaman Chat & Realtime Hub
- [ ] Buat fungsi pencegah Hard Reload saat koneksi realtime terputus
- [ ] Implementasi fungsi Rekonsiliasi Data pintar untuk resource terdampak pasca-offline

## 🛡️ FASE 5: VALIDASI SECURITY (BYPASS CACHE)
- [ ] Bypass cache untuk Status Pembayaran (Wajib Realtime Backend)
- [ ] Bypass cache untuk Hak Premium & Fitur Berbayar
- [ ] Bypass cache untuk Role & Permission
- [ ] Bypass cache untuk Akses Organisasi & Status Tiket

## 🧪 FASE 6: CI REGRESSION CHECK
- [x] Konfigurasi script Linting di CI pipeline
- [x] Konfigurasi Typecheck (TypeScript) di CI pipeline
- [x] Pastikan proses Build sukses tanpa error arsitektur baru
- [x] Buat skenario Production Smoke Test untuk fitur kritikal

## 🔐 ATURAN EKSEKUSI
1. Cache hanya mempercepat render dan mengurangi query/egress; cache tidak boleh menentukan permission, role, payment, entitlement, akses organisasi, status ticket, atau hasil aksi sensitif.
2. Realtime menjadi change signal. Jangan mengganti arsitektur dengan polling interval pendek.
3. Selective sync harus mengambil data terdampak saja; hindari reload koleksi besar setelah perubahan kecil.
4. Setelah reconnect/offline, lakukan reconciliation terhadap backend untuk resource yang terdampak karena Realtime tidak dijamin mengirim semua event selama disconnect.
5. Cache user harus dipisahkan berdasarkan user ID dan invalidasi saat logout/ganti akun.
6. Setiap fitur baru wajib dicatat ke fase audit ini sebelum dinyatakan selesai.
7. Audit `[x]` berarti pemetaan arsitektur selesai; implementasi optimasinya tetap harus mengikuti Fase 3–5 dan tidak boleh dianggap selesai hanya karena sudah diaudit.

## 📍 STATUS SAAT INI
**Implementasi berjalan:** shared cache registry, cache versioning, per-user keys, TTL policy, stale-cache API + penggunaan SWR pada Notifications dan Awards, auto-clear cache lifecycle saat logout/ganti akun, realtime-driven cache invalidation, platform/home shared cache, dan penghapusan double subscription chat mobile.

**Belum selesai:** selective sync lintas seluruh fitur, konsolidasi Realtime untuk resource yang belum punya change signal, reconnect reconciliation, pembersihan redundansi Chat, security bypass verification untuk payment/premium/role/org/ticket, serta regression verification final untuk batch perubahan ini.