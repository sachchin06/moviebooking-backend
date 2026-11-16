# 0005. Booking transitions take a row lock, so cancel and confirm take turns

**Status:** accepted

## Context

Several actors change a booking's status: the guest (cancel), the payment flow (mark payment pending, confirm, fail), the expiry sweep and the stale-hold reclaim. Guest cancel used to read the booking, check its status and save it without a lock. A confirm committing in between could be overwritten with FAILED: a paid booking lost.

## Options

1. Optimistic concurrency (a version column, retry on conflict).
2. A pessimistic row lock for the length of each transition.

## Decision

Option 2. Every transition runs in one transaction that first reads the booking with a `pessimistic_write` lock (`UPDLOCK, ROWLOCK` on SQL Server), then checks the transition against the booking state machine and writes. The state machine's transition table lives in `libs/database`, so the booking service and the seat-conflict repair apply the same rules.

Guest cancel is allowed only in HOLDING (once payment has started, the outcome belongs to the payment flow) and needs the booking's email as well as its reference. A wrong email gets the same 404 as an unknown reference.

## Evidence

The integration suite races a guest cancel against mark-payment-pending followed by confirm, 10 rounds. Exactly one of them wins every time, and a later cancel of a confirmed booking gets 422 and leaves it CONFIRMED.

## Consequences

- No lost updates; the loser sees the winner's result.
- Transitions on the same booking are serialised, which is cheap because they are rare.
- Transactions use `dataSource.transaction()`, so a business error rolls back exactly once and reaches the client as 404 or 422. Manual rollback followed by a second rollback used to turn these into 500s.
