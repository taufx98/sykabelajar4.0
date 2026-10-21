# Rilis SYKABELAJAR 4.0 — secure linear exam

Tujuan: memasang UI dan backend ujian satu-soal-per-request tanpa memutus UI ujian lama sebelum frontend baru siap.

## Status saat ini

- Migration phase 1 dan skrip lockdown phase 2 telah diuji sebagai satu transaksi SQL lalu di-`ROLLBACK`.
- Database production `mvdczyitbkxkldjughor` **belum diubah** oleh pengerjaan ini.
- Uji CI terbaru harus tetap hijau sebelum PR dirilis.
- Skrip phase 2 sengaja berada di `supabase/manual/`, bukan `supabase/migrations/`, agar tidak ikut dijalankan otomatis bersamaan dengan migration additive.

## Urutan deployment wajib

1. **Phase 1 — backend additive.** Buka `supabase/migrations/20261021121831_linear_server_authoritative_exam_phase1.sql` pada branch PR #47 dan jalankan seluruh SQL-nya pada SQL Editor project Supabase production yang benar. Phase ini membuat snapshot soal, timer server, RPC baru, audit event, dan proteksi perubahan soal; jalur lama belum dicabut.
2. **Deploy frontend baru.** Setelah phase 1 berhasil, merge/deploy PR #47 sehingga halaman individual dan kolektif memakai RPC linear yang baru. Jangan mulai ujian live untuk peserta sebelum CI hijau dan build baru aktif.
3. **Verifikasi smoke test.** Gunakan lomba uji dengan akun uji: mulai attempt, jawab dan lanjut, biarkan timer habis, cek pilihan 30 detik, cek auto-skip, lalu buka tombol **Pantau Ujian** dari konfigurasi lomba. Pastikan peserta tidak menerima nilai/skor pada layar selesai.
4. **Phase 2 — lockdown.** Setelah frontend baru terbukti aktif, jalankan seluruh SQL dari `supabase/manual/linear_exam_security_lockdown.sql` lewat SQL Editor. Ini menutup RPC lama, melarang baca semua soal melalui table API, membatasi baca skor attempt peserta, serta membuang jalur tulis jawaban langsung.

**Jangan menjalankan phase 2 sebelum frontend baru aktif.** Jika dilakukan terlalu cepat, UI lama kehilangan RPC yang digunakannya. Skrip phase 2 bukan migration otomatis dan sengaja dipisah agar urutan ini dapat dikendalikan.

## Perilaku keamanan

- Timer, deadline, transisi waktu, jawaban final dan penilaian dihitung oleh backend.
- Draft belum dihitung sebagai jawaban. Hanya soal berstatus `ANSWERED` yang masuk penilaian; draft soal yang timeout dihapus.
- Hasil tidak dikembalikan kepada peserta sampai status lomba menjadi `RESULT_PUBLISHED` atau `ARCHIVED`. Panel OG tidak menampilkan isi jawaban atau skor.
- Legacy attempt yang sudah memiliki jawaban tetapi belum punya snapshot linear ditolak otomatis dengan `LEGACY_ATTEMPT_REQUIRES_REVIEW`; periksa manual, jangan reset atau migrasikan otomatis.
