# Rilis SYKABELAJAR 4.0 — secure linear exam

Tujuan: memasang UI dan backend ujian satu-soal-per-request tanpa memutus UI ujian lama sebelum frontend baru siap.

## Status saat ini

- Migration phase 1 dan skrip lockdown phase 2 telah diuji sebagai satu transaksi SQL lalu di-`ROLLBACK`.
- Migration Phase 1 sudah diterapkan ke production Supabase project `mvdczyitbkxkldjughor` dan tercatat sebagai `20261021121831 / linear_server_authoritative_exam_phase1`.
- Migration kompatibilitas grading sudah diterapkan sebagai `20261021122452 / linear_exam_preserve_grading_compat`; ini mempertahankan Premium AI essay grading, accepted answers lama, dan XP otomatis.
- Migration hotfix penyelesaian attempt `20261021124911 / fix_linear_exam_completion_status_enum` telah memperbaiki cast enum status yang ditemukan oleh uji integrasi.
- Verifikasi production memastikan tiga tabel engine ada, RPC baru memiliki izin eksekusi, jalur legacy tetap punya izin, dan saat dicek tidak ada attempt `IN_PROGRESS`.
- Lockdown Phase 2 **belum diterapkan**. Uji CI untuk commit terakhir sebelum rename migration lulus; commit rename ini menjalankan CI ulang.
- Skrip phase 2 sengaja berada di `supabase/manual/`, bukan `supabase/migrations/`, agar tidak ikut dijalankan otomatis bersamaan dengan migration additive.

## Urutan deployment wajib

1. **Phase 1 — backend additive (sudah dilakukan).** Migration `supabase/migrations/20261021121831_linear_server_authoritative_exam_phase1.sql` telah diaplikasikan dan tercatat di ledger. Ia membuat snapshot soal, timer server, RPC baru, audit event, dan proteksi perubahan soal; jalur legacy masih aktif.
2. **Kompatibilitas grading (sudah dilakukan).** Migration `supabase/migrations/20261021122452_linear_exam_preserve_grading_compat.sql` mempertahankan penilaian esai otomatis Premium, jawaban singkat dari `question_options`, dan XP kompetisi untuk attempt yang selesai otomatis.
3. **Deploy frontend baru.** Setelah phase 1 berhasil, merge/deploy PR #47 sehingga halaman individual dan kolektif memakai RPC linear yang baru. Jangan mulai ujian live untuk peserta sebelum CI hijau dan build baru aktif.
4. **Verifikasi smoke test.** Gunakan lomba uji dengan akun uji: mulai attempt, jawab dan lanjut, biarkan timer habis, cek pilihan 30 detik, cek auto-skip, lalu buka tombol **Pantau Ujian** dari konfigurasi lomba. Pastikan peserta tidak menerima nilai/skor pada layar selesai.
5. **Phase 2 — lockdown.** Setelah frontend baru terbukti aktif, jalankan seluruh SQL dari `supabase/manual/linear_exam_security_lockdown.sql` lewat SQL Editor. Ini menutup RPC lama, melarang baca semua soal melalui table API, membatasi baca skor attempt peserta, serta membuang jalur tulis jawaban langsung.

**Jangan menjalankan phase 2 sebelum frontend baru aktif.** Jika dilakukan terlalu cepat, UI lama kehilangan RPC yang digunakannya. Skrip phase 2 bukan migration otomatis dan sengaja dipisah agar urutan ini dapat dikendalikan.

## Perilaku keamanan

- Timer, deadline, transisi waktu, jawaban final dan penilaian dihitung oleh backend.
- Draft belum dihitung sebagai jawaban. Hanya soal berstatus `ANSWERED` yang masuk penilaian; draft soal yang timeout dihapus.
- Hasil tidak dikembalikan kepada peserta sampai status lomba menjadi `RESULT_PUBLISHED` atau `ARCHIVED`. Panel OG tidak menampilkan isi jawaban atau skor.
- Legacy attempt yang sudah memiliki jawaban tetapi belum punya snapshot linear ditolak otomatis dengan `LEGACY_ATTEMPT_REQUIRES_REVIEW`; periksa manual, jangan reset atau migrasikan otomatis.
