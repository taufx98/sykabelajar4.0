# SYKABELAJAR 4.0 — Phase 10 Payment Extension

Date: 2026-09-06
Status: COMPLETE

## Goal

Harden organizer and certificate payment operations so order status changes, manual payment review, plan activation, voucher usage, and collective certificate payment synchronization remain server-authoritative and resistant to invalid state transitions.

## Implemented / verified

- Organizer plan checkout uses server-calculated pricing, discount, voucher, payment method, and total.
- Organizer plan activation occurs server-side after valid payment completion.
- Manual payment review is admin-only and now accepts only explicit `APPROVE` or `REJECT` decisions.
- Manual payment review only processes orders still in `PENDING_PAYMENT` state.
- Voucher usage and rollback remain transactionally tied to manual payment approval/rejection.
- Collective certificate orders remain linked to `orders` through a unique certificate-order mapping.
- Paid collective certificate orders are synchronized to published certificate state by a database trigger.

## Order state-machine hardening

Allowed administrative order progression is now enforced server-side:

`DRAFT → PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → COMPLETED`

Cancellation is allowed from appropriate pre-completion states, and `REFUNDED` is terminal. Invalid status jumps are rejected. Refund transitions require a reason.

## RPC security

- `admin_transition_order`: authenticated-only and admin-gated.
- `admin_review_manual_order`: authenticated-only and admin-gated.
- Organizer plan order creation remains authenticated-only and organizer-scoped.
- Collective certificate order creation remains authenticated-only and participant/manager/admin-scoped.
- Public-facing payment configuration remains exposed only through intended read contracts.

## Idempotency / duplicate protection

Collective certificate orders already have a unique mapping by `collective_certificate_id` and reuse an existing non-cancelled/non-refunded order. This prevents duplicate certificate orders for the same certificate.

## Legacy safety

No destructive replacement of the existing order, organizer plan, voucher, certificate, or collective certificate structures was performed.

## Exit criteria

- Payment totals and entitlement decisions remain server-authoritative.
- Manual review cannot approve arbitrary decision strings.
- Manual review cannot mutate already-finalized orders.
- Order status transitions are constrained by the payment state machine.
- Admin order mutation RPCs are not executable by `anon`.
- Collective certificate payment remains synchronized to certificate publication.
- Final Phase 10 CI must pass.

## Next phase

Phase 11 — Experience Transformation.
