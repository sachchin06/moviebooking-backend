# 0001. A filtered unique index on live holds is the guarantee against double-booking

**Status:** accepted (migration M7)

## Context

Many guests can ask for the same seat at the same moment. Application checks ("is this seat free?" followed by "insert a hold") leave a gap between the check and the write, and any second instance of the service, any bug or any skipped lock can slip through it. Originally a confirmed booking's holds became RELEASED, which took sold seats out of the only unique index (`WHERE status = 'ACTIVE'`), so a sold seat was protected by application code alone.

## Options

1. Application checks inside a transaction at a higher isolation level (SERIALIZABLE).
2. Distributed locks only (Redis).
3. A database constraint that makes a second claim on a seat impossible.

## Decision

Option 3. Each seat a booking claims has a row in `seat_holds`. A hold is ACTIVE while reserved and becomes CONVERTED when the booking is confirmed. One filtered unique index covers both:

```sql
CREATE UNIQUE INDEX idx_seat_holds_unique_live
ON seat_holds (show_id, seat_id)
WHERE status IN ('ACTIVE', 'CONVERTED');
```

A second live hold on a held or sold seat fails with SQL Server error 2601, which the booking service turns into 422. Application checks still run first, for clear error messages, but the index is the guarantee.

Migration M7 converts existing data and refuses to run if a seat is already claimed twice, because choosing who keeps a seat is a business decision. `npm run db:repair-seat-conflicts` resolves the safe cases explicitly.

## Evidence

The integration suite sends 20 hold requests for one seat at the same time, with Redis unreachable so the index is the only guard: exactly one succeeds and 19 get 422. In a mutation run with the index dropped, the same test produced **20 winners**.

## Consequences

- The guarantee holds for any number of service instances and survives application bugs.
- Holds must leave the index exactly once (ACTIVE → CONVERTED, EXPIRED or RELEASED). All status changes go through one helper that only touches ACTIVE holds and can never set ACTIVE.
- Inserts on a contested seat wait on key locks; the loser waits briefly, then gets the duplicate-key error.
