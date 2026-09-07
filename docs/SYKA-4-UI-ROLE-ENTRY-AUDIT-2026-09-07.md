# SYKABELAJAR 4.0 — UI Role Entry Audit

Date: 2026-09-07

## Findings

- The public `/login` entry already exposes Pelajar, Guru, and Penyelenggara role selection.
- The collective participant login exists at `/peserta-kolektif/login` but was not discoverable from the authenticated/global navigation surface.
- The Guru workspace routes exist and are role-guarded, but the main authenticated navigation did not expose a Guru workspace entry for users whose resolved role is `guru`.
- The mobile primary navigation also fell back to Leaderboard for Guru users instead of the Guru workspace.

## Remediation

- Expose `/guru` as the primary workspace entry for resolved Guru accounts in desktop and mobile navigation.
- Keep role authorization server-backed through the existing `RoleRoute`; this change only restores discoverability and does not weaken permissions.
- Keep collective participant authentication as a separate public portal at `/peserta-kolektif/login`.

## PRD alignment

The Master PRD defines Login as the public entry and a dedicated Guru Workspace containing roster, collective registration, monitoring, access credentials, access cards, result/certificate, and group chat capabilities. It also defines a separate collective participant portal using portal password plus participant code.

## Safety boundary

No database migration, RLS change, payment change, participant identity change, certificate lifecycle change, or backend contract change is introduced by this audit remediation.
