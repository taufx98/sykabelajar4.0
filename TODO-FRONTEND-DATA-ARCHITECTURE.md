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
- [ ] Buat fungsi Auto-Clear cache saat user logout / ganti akun
- [x] Pastikan prinsip cache hanya untuk 'fast render', bukan source of truth

## 🔍 FASE 2: AUDIT & PEMETAAN SUPABASE
- [x] Audit halaman: Home / Competition
- [x] Audit halaman: Leaderboard
- [x] Audit halaman: Profile
- [ ] Audit halaman: Awards
- [x] Audit halaman: Notifications
- [ ] Audit halaman: Orders
- [ ] Audit halaman: Feed
- [ ] Audit halaman: Organizer
- [ ] Audit halaman: Admin
*Catatan: Tentukan (1) tipe cache, (2) realtime event, (3) jadwal selective sync, (4) kapan wajib query backend.*

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

## 📍 STATUS SAAT INI
**Implementasi berjalan:** shared cache registry, cache versioning, per-user keys, TTL policy, stale-cache API + penggunaan SWR pada Notifications, realtime-driven cache invalidation, notification cache-first, platform/home shared cache, dan penghapusan double subscription chat mobile.

**Belum selesai:** auto-clear cache logout/ganti akun, selective sync lintas seluruh fitur, reconnect reconciliation, audit Orders/Awards/Feed/Organizer/Admin, security bypass verification untuk payment/premium/role/org/ticket, serta regression verification final untuk batch perubahan ini.