# Mode Simulasi Penyelenggara — SYKABELAJAR 4.0

## Alur produk
Buat soal → pilih **Simulasi** atau **Release** → jika Release lolos validasi server, status lomba menjadi `PUBLISHED`. Simulasi opsional dan tidak mengubah status lomba.

## Ketentuan UX
- Simulasi menggunakan komponen `LinearExamRoom` yang sama persis dengan peserta.
- Timer, autosave, one-question flow, penguncian jawaban, timeout, grace window, dan transisi soal tetap dikendalikan oleh RPC linear backend yang sama.
- Sesudah sesi selesai, penyelenggara diarahkan ke laporan khusus simulasi untuk memeriksa jawaban, kunci, dan nilai otomatis sementara.

## Penyimpanan
Tidak ada tabel khusus simulasi. Migration menambahkan `attempts.is_preview` dan `attempts.preview_owner_id`. Jawaban, runtime, snapshot soal, dan event menggunakan tabel existing. Ketika simulasi dimulai ulang, attempt simulasi lama milik penyelenggara untuk lomba tersebut dihapus secara transaksional; attempt resmi tidak ikut terhapus.

## Pengamanan
- RPC start hanya untuk lomba `DRAFT` yang dimiliki/diakses penyelenggara.
- Semua state/answer/timeout RPC linear tetap memvalidasi pemilik attempt; attempt preview hanya dapat diakses `preview_owner_id`.
- Preview dibuat tanpa participant, registration, atau canonical participant, sehingga tidak mendapatkan XP/reward dan tidak ikut hasil canonical.
- Grading preview tidak masuk antrean penilaian resmi; fungsi manual grading menolak attempt preview.
- Release memakai RPC server-side yang memvalidasi kepemilikan, jadwal, jumlah soal published, dan durasi sebelum memperbarui status menjadi `PUBLISHED`.

## File utama
- `src/pages/OrganizerCompetitionConfigPage.tsx`
- `src/pages/OrganizerExamPreviewPage.tsx`
- `src/pages/OrganizerExamPreviewReportPage.tsx`
- `src/components/exam/LinearExamRoom.tsx`
- `src/services/linearExam.service.ts`
- `src/services/manualGrading.service.ts`
- `supabase/migrations/20261021140005_organizer_exam_simulation_same_tables.sql`

## Verifikasi
Build/CI tetap wajib berjalan setelah PR dibuat. Setelah migration diterapkan dan frontend dideploy, uji lomba Draft: simulasi, refresh, timeout, laporan, ulangi simulasi, pastikan status masih Draft; lalu uji Release terpisah dan pastikan status menjadi PUBLISHED. Periksa tidak ada XP, reward, antrean grading, atau hasil resmi yang berasal dari simulasi.
