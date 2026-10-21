# Rilis SYKABELAJAR 4.0 — secure linear exam

Status implementasi: kode frontend sudah masuk `main`, ketiga migration backend sudah diterapkan di Supabase production, legacy lockdown sudah aktif, dan pengujian CI terbaru berhasil.

## Migration production

- `20261021121831 / linear_server_authoritative_exam_phase1`: snapshot soal per attempt, timer di server, RPC linear, log kejadian, dan fondasi state machine.
- `20261021122452 / linear_exam_preserve_grading_compat`: menjaga Premium AI essay grading, jawaban singkat yang memakai `question_options`, dan XP otomatis.
- `20261021124911 / fix_linear_exam_completion_status_enum`: memperbaiki error runtime ketika penyelesaian attempt mengisi kolom enum status dari ekspresi `CASE` bertipe `text`.
- `20261021125110 / linear_exam_security_lockdown`: menutup RPC ujian lama, membatasi direct read soal dan attempt selesai, serta mencabut jalur insert/update jawaban langsung.

File migration di `supabase/migrations/` cocok dengan versi yang tercatat pada ledger production.

## Hasil verifikasi

- CI `main` pada commit yang menambahkan smoke-release marker lulus: lint, typecheck, build, browser E2E access-control, dan production smoke test. Smoke test kini memastikan halaman production menyajikan marker `linear-exam-secure-v1`, bukan sekadar mengembalikan HTML.
- Uji integrasi individual dan kolektif dijalankan langsung pada database production dalam transaksi rollback-only. Keduanya lulus untuk mulai attempt, timeout, keputusan 30 detik, pinjaman 30 detik, grace period, auto-skip, penghapusan draft yang belum dikunci, grading server, dan penahanan skor sampai hasil dipublikasikan.
- Setelah lockdown, verifikasi juga memastikan RPC legacy individual/kolektif sudah tidak dapat dieksekusi, RPC linear tetap tersedia, direct write policy jawaban sudah hilang, dan RPC hasil canonical mengembalikan `published: false` tanpa skor sebelum pengumuman.
- Seluruh data lomba/roster/attempt yang dipakai oleh smoke test dibatalkan di dalam transaksi; pengecekan setelah tes mengonfirmasi tidak ada data tes tersisa.
- Saat pemeriksaan terakhir, production memiliki nol lomba berstatus `LIVE` dan nol attempt `IN_PROGRESS`. Karena tidak ada lomba aktif, tes belum dilakukan oleh peserta manusia pada lomba yang sedang berjalan; yang sudah lulus adalah alur integrasi server yang disimulasikan dan dibatalkan dalam transaksi.

## Perilaku keamanan

- Timer, deadline, transisi timeout, jawaban final, dan grading diputuskan server.
- Draft bukan jawaban final. Hanya soal dengan status `ANSWERED` dinilai; draft untuk soal yang timeout dihapus.
- Peserta hanya menerima satu soal aktif dari RPC linear; hasil tidak dikirim sebelum status lomba menjadi `RESULT_PUBLISHED` atau `ARCHIVED`.
- Panel OG menampilkan progres, timeout, skip, dan jejak peristiwa tanpa membuka isi jawaban atau nilai peserta.
- Attempt lama yang sudah berisi jawaban tetapi belum memiliki snapshot linear ditolak dengan `LEGACY_ATTEMPT_REQUIRES_REVIEW`. Jangan reset atau migrasikan attempt lama otomatis; periksa manual.

Security lockdown sudah aktif. Jangan membuka kembali RPC lama hanya untuk mengatasi attempt lawas; periksa attempt tersebut melalui jalur review yang sesuai.
