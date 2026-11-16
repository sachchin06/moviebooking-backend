# 0007. A shared internal API key, compared in constant time

**Status:** accepted (to be replaced; see [ROADMAP](../../ROADMAP.md), "Per-service identity")

## Context

Each service exposes `/api/internal/*` routes for the others on its public port. One of them confirms a booking. Without authentication, anyone who could reach the port could confirm a booking without paying, or read guest and admin emails.

## Options

1. Rely on network isolation alone.
2. A shared secret header checked by a guard.
3. Per-service identities (mutual TLS or signed service tokens).

## Decision

Option 2 for now. `InternalApiGuard` requires `X-Internal-Key` to equal `INTERNAL_API_KEY`, or the request gets 401. The comparison hashes both values with SHA-256 and compares the digests with `crypto.timingSafeEqual`. Equal-length buffers avoid leaking the key's length, and the constant-time comparison means response time does not reveal how many leading characters were right. Every service refuses to start without the key, and the shared HTTP client sends it on every call.

## Consequences

- Internal routes are closed to anyone without the key; tests check for 401 over real HTTP in three services.
- It is one key for all services. A leak opens every internal route, and the routes cannot tell which service is calling. Option 3 is on the roadmap.
