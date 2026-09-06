# SYKABELAJAR 4.0 — Phase 9 Certificate Lifecycle

Date: 2026-09-06
Status: COMPLETE

## Goal

Make certificate issuance and verification lifecycle deterministic and safe across individual and collective participants: eligibility, generation, review/approval, publication, serial allocation, public verification, payment-linked collective issuance, and revocation.

## Implemented / verified

- Individual certificate issuance is linked to the canonical participant identity.
- Collective certificate preparation is linked to the canonical participant identity.
- Certificate assets are managed through an authenticated server RPC with owner/organizer/admin authorization checks.
- Collective certificate orders remain linked to the existing order lifecycle.
- Paid collective certificate orders are synchronized server-side to certificate publication.
- Public certificate verification returns only intended verification fields.
- Published collective certificates are exposed through the narrow public verification RPC.
- Organizer serial generation, assignment, and revocation remain permission- and entitlement-gated.
- Certificate and verification tables retain RLS protection.

## State-machine hardening

Certificate administration now follows an explicit state machine:

`DRAFT → GENERATED → REVIEW → APPROVED → PUBLISHED → REVOKED`

Generated/review/approved certificates may also move directly to `REVOKED` when required. A `REVOKED` certificate cannot be reopened through the admin transition RPC. Revocation requires a non-empty reason and is audited.

Both admin certificate transition entry points use the same transition validation logic, preventing arbitrary status jumps from the client.

## RPC security

- `admin_set_certificate_status`: authenticated-only, admin-gated.
- `admin_transition_certificate`: authenticated-only, admin-gated.
- `create_certificate_asset`: authenticated-only, owner/organizer/admin-gated.
- `issue_certificate_for_award`: authenticated-only, organizer/admin-gated.
- `prepare_collective_certificate`: authenticated-only.
- `create_collective_certificate_order`: authenticated-only.
- Public verification functions intentionally remain available to `anon`.

## Frontend

- Admin certificate lifecycle management remains at `/admin/operations/certificates`.
- Individual certificate history uses the canonical certificate service contract.
- Collective certificate visibility uses published-only access and separate serial/verification identifiers.

## Legacy safety

No destructive replacement of existing certificate, verification, serial, order, attempt, or participant structures was performed. The legacy schema remains compatible with the canonical participant linkage introduced in Phase 3.

## Production verification

- Certificate, verification, asset, collective certificate, collective certificate order, and organizer serial tables are RLS-enabled.
- Sensitive certificate mutation RPCs are not executable by `anon`.
- Public verification RPCs remain intentionally readable by `anon`.
- Existing production certificate/collective-certificate population remains safe because no destructive data migration was performed.

## Exit criteria

- Individual and collective certificate paths share the canonical participant foundation.
- Certificate publication and verification rules are enforced server-side.
- Serial assignment and verification identity remain distinct.
- Revocation is audited and cannot silently reopen through the transition endpoint.
- Sensitive mutation RPCs are authenticated-only.
- Frontend CI passes on the final Phase 9 commit.

## Next phase

Phase 10 — Payment Extension.
