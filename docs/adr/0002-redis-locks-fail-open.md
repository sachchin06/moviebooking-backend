# 0002. Redis seat locks are a fast path that fails open

**Status:** accepted

## Context

Under heavy demand most requests for a popular seat will lose. Sending all of them into SQL Server transactions only for the unique index to reject them wastes connections and lock time.

## Options

1. Database only: let the index reject the losers.
2. Redis locks as the guarantee, refusing all bookings when Redis is down.
3. Redis locks in front of the database as an optimisation, with the index still the guarantee.

## Decision

Option 3. Before its transaction, a hold request locks each seat in Redis with `SET lock:seat:<show>:<seat> <nonce> PX 8000 NX`, in ascending seat ID order. It retries every 50 ms for up to 500 ms; a seat still locked after that gets 422 straight away. Locks are released by a Lua script that deletes the key only if it still holds the request's own nonce, so a request never releases another's lock.

If Redis cannot be reached, the lock service **fails open**: it logs a warning and the request continues to the database, where the unique index ([0001](0001-unique-index-on-live-holds.md)) still decides.

## Consequences

- Most losers are turned away by Redis without touching SQL Server.
- A Redis outage degrades performance, not correctness. The integration suite runs the 20-way contention test both with Redis and with Redis unreachable, and both give exactly one winner.
- A lock that outlives its 8-second TTL could expire while its holder is still working. That is safe for the same reason: the index decides.
