# 0003. Expired holds are reclaimed by the next request, with a fixed lock order

**Status:** accepted

## Context

A hold has a deadline (5 minutes, longer once payment starts). A sweep runs every minute and expires overdue bookings, but until it does, an expired hold is still ACTIVE and still inside the unique index. The seat map already shows the seat as free, yet a new hold for it would fail for up to a minute.

Releasing those holds inside a request means locking other bookings' rows, which brings a deadlock risk when requests overlap.

## Options

1. Run the sweep more often (it still leaves a window, and costs more).
2. Treat expired holds as free in the index (filtered indexes cannot depend on the current time).
3. Let the request that wants the seat expire the stale booking itself, inside its own transaction.

## Decision

Option 3. Before its free-seat checks, the hold transaction finds ACTIVE holds on the requested seats whose `expires_at` has passed. It locks their bookings and re-checks each deadline under the lock, because a payment may have arrived in the meantime. Overdue bookings then expire through the state machine, using the same helper as the sweep. The whole booking expires, all its seats together: a reservation is one unit with one timer.

Lock order, which is why this cannot deadlock:

1. Redis seat locks, in ascending seat ID order.
2. Booking rows of stale holds, in ascending booking ID order.
3. A booking row before that booking's holds. Confirm, cancel, payment failure and the sweep all follow the same order.
4. New `booking_seats` and `seat_holds` rows in ascending seat ID order. The integration suite found the need for this: without Redis, requests for `[A3, A1]` and `[A1, A2]` took index locks in opposite orders and occasionally deadlocked. Sorting removed the failures: 0 in 540 overlapping requests, against 2 in 120 before.

## Consequences

- A seat is holdable the moment its hold expires.
- `booking.expired` is published for reclaimed bookings as well as swept ones.
- A hold request can wait briefly on another booking's row lock.
