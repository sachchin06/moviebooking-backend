# 0004. Show scheduling is serialised per screen with `sp_getapplock`

**Status:** accepted

## Context

Two shows must not overlap on the same screen. The check ("is anything scheduled between these times?") and the insert were separate statements, so two admins creating shows at the same moment could both see a free slot and both save.

## Options

1. A unique constraint: not possible, because overlap is a range condition, not equality.
2. `UPDLOCK, HOLDLOCK` on the overlap query, relying on key-range locks.
3. An application lock named after the screen, held for the transaction.

## Decision

Option 3. Creating a show, or changing its time or reactivating it, runs in one transaction that first calls:

```sql
EXEC sp_getapplock @Resource = 'show-schedule:screen:<id>',
     @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
```

It then checks for overlap and writes. A second change to the same screen waits until the first commits, then sees its row. A timeout or deadlock returns 409 with a request to retry.

Why not option 2: the overlap test is a range on two columns (`starts_at < :end AND ends_at > :start`). Which key ranges get locked depends on the index the optimiser picks, and could cover far more than one screen. An application lock is explicit, cheap, and exactly one screen wide.

## Evidence

Checked on SQL Server: a second transaction on the same screen waited for the first to commit; a 200 ms timeout was refused with `-1`; a different screen did not wait.

## Consequences

- Schedule changes on one screen are serialised; different screens still run in parallel.
- The lock lives only in SQL Server. Code that writes shows without going through the service would bypass it.
- The check for live bookings (an HTTP call to the booking service) happens before the transaction, so no lock is held during network I/O.
