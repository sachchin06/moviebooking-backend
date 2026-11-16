# 0009. A payment after the deadline goes to PENDING_REVIEW

**Status:** accepted

## Context

Payment providers confirm asynchronously. A guest can complete payment while their reservation is expiring, so the confirmation can arrive after the booking's payment deadline. By then the seats may be on offer again.

## Options

1. Confirm anyway, and risk selling a seat that is no longer reserved.
2. Reject the confirmation, and keep money for a booking that does not exist.
3. Record the conflict for a person to resolve.

## Decision

Option 3. If a confirmation arrives for a PAYMENT_PENDING booking after `payment_expires_at`, the booking moves to PENDING_REVIEW with the reason `VERIFIED_PAYMENT_AFTER_EXPIRY`. Its holds are released in the same transaction, so the seats do not stay blocked waiting for a review. PENDING_REVIEW is terminal in the state machine.

## Consequences

- No seat is sold twice, and no payment silently disappears; the review list shows exactly which bookings need a refund or rebooking.
- The guest loses the seats while their case is reviewed.
- The refund itself is not automated. That belongs to the payment service, which does not exist yet. A confirmation for a booking that is already EXPIRED is rejected (422) and will need the same treatment there.
