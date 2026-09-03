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
- [x] Audit halaman: Home / Competition — shared/public cache; Realtime competition/banner; selective patch untuk item competition yang berubah; backend wajib untuk aksi registration/eligibility.
- [x] Audit halaman: Leaderboard — public cache TTL; profile change signal melakukan selective revalidation karena ranking adalah data turunan; backend tetap authoritative untuk ranking.
- [x] Audit halaman: Profile — per-user cache untuk fast render; Realtime profile signal; permission/role/verification tetap backend.
- [x] Audit halaman: Awards — per-user cache + SWR; sertifikat/verification tetap backend-authoritative.
- [x] Audit halaman: Notifications — per-user cache + SWR; Realtime notification insert/read; backend authoritative untuk status read.
- [x] Audit halaman: Orders — daftar metadata boleh cache, tetapi status pembayaran/payment proof wajib live backend; aksi order melalui RPC/RLS.
- [x] Audit halaman: Feed — public cache TTL; global Realtime `posts` change signal; selective patch berdasarkan `post.id`.
- [x] Audit halaman: Organizer — workspace di-refresh secara selective melalui `organizer_members` Realtime signal; membership/entitlement/access code/plan tetap backend-authoritative.
- [x] Audit halaman: Admin — default no-cache untuk payment, role, permission, premium, fulfillment, moderation, and other sensitive transactional state; cache hanya read-only UI/list yang jelas aman; semua aksi tetap RPC/RLS/backend.

*Catatan audit: untuk setiap fitur sudah ditentukan (1) tipe cache, (2) realtime event/signal yang tersedia, (3) pola selective sync yang dibutuhkan, (4) kondisi wajib query backend.*

## 🔄 FASE 3: STANDARDISASI POLA ALUR DATA
- [x] Refaktor alur: Ambil dari Local Cache -> Render Cepat
- [x] Hubungkan ke Realtime Change Signal
- [x] Implementasi fungsi Selective Sync (hanya update data yg berubah) — Feed melakukan patch `post.id`; Competition melakukan patch item/cache berdasarkan `competition.id`; leaderboard melakukan selective revalidation karena perubahan satu profil dapat mengubah banyak peringkat; organizer workspace melakukan refresh hanya saat membership signal berubah; resource sensitif tetap memakai backend live query sesuai Fase 5.
- [x] Pastikan Backend / RLS selalu menjadi otoritas final data

## 💬 FASE 4: OPTIMASI CHAT & REKONSILIASI KONEKSI
- [x] Hapus double-subscription / query antara AppLayout & Mobile Navigation
- [x] Bersihkan redundansi di Halaman Chat & Realtime Hub — `MessagesPageV6` tidak lagi membuat subscription `chat-thread-index-*`; global Realtime Hub menjadi signal daftar thread, sedangkan `chat-active-*` tetap scoped untuk pesan thread aktif.
- [x] Buat fungsi pencegah Hard Reload saat koneksi realtime terputus — Supabase client dibiarkan melakukan reconnect otomatis; UI menerima status degraded/reconnected tanpa reload halaman.
- [x] Implementasi fungsi Rekonsiliasi Data pintar untuk resource terdampak pasca-offline — setelah reconnect user channel hanya merekonsiliasi `chat_threads` + unread count, bukan seluruh runtime.

## 🛡️ FASE 5: VALIDASI SECURITY (BYPASS CACHE)
- [x] Bypass cache untuk Status Pembayaran (Wajib Realtime Backend) — OrdersPage membaca `orders` langsung dari backend pada setiap load; tidak menggunakan presentation cache untuk status pembayaran/payment proof.
- [x] Bypass cache untuk Hak Premium & Fitur Berbayar — OrganizerPlanPage mengambil entitlement aktif via `getActiveOrganizerEntitlements()` langsung dari backend serta katalog plan live; hasil cache tidak dipakai sebagai otorisasi.
- [x] Bypass cache untuk Role & Permission — AppContext melakukan bootstrap/profile + `getUserRoles()` dari backend; RoleRoute hanya menggunakan role yang dihasilkan dari state otoritatif tersebut, sementara aksi sensitif tetap RPC/RLS.
- [x] Bypass cache untuk Akses Organisasi & Status Tiket — akses organizer di-resolve via `resolveCurrentUserOrganizer()` backend-authoritative; `loadMyThread()` memanggil `loadMyThreads(true)` sehingga status open/closed ticket tidak diambil dari presentation cache, dan RPC backend tetap menjadi enforcement akhir.

## 🧪 FASE 6: CI REGRESSION CHECK
- [x] Konfigurasi script Linting di CI pipeline
- [x] Konfigurasi Typecheck (TypeScript) di CI pipeline
- [x] Pastikan proses Build sukses tanpa error arsitektur baru
- [x] Buat skenario Production Smoke Test untuk fitur kritikal
- [ ] Final regression verification untuk batch perubahan arsitektur terbaru — menunggu hasil CI dari commit penyelesaian batch ini.

## 🔐 ATURAN EKSEKUSI
1. Cache hanya mempercepat render dan mengurangi query/egress; cache tidak boleh menentukan permission, role, payment, entitlement, akses organisasi, status ticket, atau hasil aksi sensitif.
2. Realtime menjadi change signal. Jangan mengganti arsitektur dengan polling interval pendek.
3. Selective sync harus mengambil data terdampak saja; hindari reload koleksi besar setelah perubahan kecil.
4. Setelah reconnect/offline, lakukan reconciliation terhadap backend untuk resource yang terdampak karena Realtime tidak dijamin mengirim semua event selama disconnect.
5. Cache user harus dipisahkan berdasarkan user ID dan invalidasi saat logout/ganti akun.
6. Setiap fitur baru wajib dicatat ke fase audit ini sebelum dinyatakan selesai.
7. Audit `[x]` berarti pemetaan arsitektur selesai; implementasi optimasinya tetap harus mengikuti Fase 3–5 dan tidak boleh dianggap selesai hanya karena sudah diaudit.

## 📍 STATUS SAAT INI
**Implementasi selesai:** shared cache registry, cache versioning, per-user keys, TTL policy, stale-cache API + penggunaan SWR pada Notifications dan Awards, auto-clear cache lifecycle saat logout/ganti akun, realtime-driven cache invalidation, platform/home shared cache, selective realtime patch untuk Feed dan Competition, derived leaderboard revalidation, organizer membership signal + selective workspace refresh, penghapusan double subscription chat mobile, penghapusan redundant chat thread-index subscription di `MessagesPageV6`, reconnect handling tanpa hard reload, scoped chat reconciliation setelah reconnect, dan bypass-cache verification untuk payment/premium/role/org/ticket.

**Satu item tersisa sebelum roadmap ditutup:** final regression verification dari CI untuk batch perubahan terbaru ini. Setelah CI PASS, marker harus diperbarui menjadi selesai total.
