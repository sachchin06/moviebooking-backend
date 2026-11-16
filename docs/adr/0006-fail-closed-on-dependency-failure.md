# 0006. Fail closed when another service cannot answer

**Status:** accepted

## Context

Services ask each other questions whose answers decide whether a change is allowed. Does this show have bookings? Does this screen have future shows? Which theatre does this admin manage? The original client returned `null` for any failure, so an outage looked like "not found" or "nothing there", and the change went ahead. For example, a theatre-service outage at login issued a theatre admin a token without their theatre.

## Options

1. Fail open: treat an unknown answer as "no".
2. Fail closed: refuse the change when the answer is unknown.

## Decision

Option 2, with one rule in the shared client (`BaseServiceClient`):

- a 404 from the other service is a real answer and returns `null`;
- anything else (timeout after 2 seconds, connection refused, any other status) throws `SERVICE_UNAVAILABLE` (503).

Clients for yes/no questions go further. If the reply is a 404 for the endpoint itself or malformed, they also throw 503, never "no".

## Consequences

- A change is never allowed on a guess: rescheduling or deleting a show, deactivating a screen or theatre, logging in a theatre admin.
- Availability suffers instead. If the theatre or movie service is down, the show list returns 503 rather than shows with blank fields.
- There are no retries or circuit breakers yet.
