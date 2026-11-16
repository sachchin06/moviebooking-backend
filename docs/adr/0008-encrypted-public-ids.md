# 0008. Public IDs are encrypted with AES-256-GCM

**Status:** accepted

## Context

The tables use sequential integer keys. Exposed as-is in URLs, they let anyone count records (`/api/movies/1`, `/2`, `/3` …) and estimate business volume.

## Options

1. Change every primary key to a UUID.
2. Keep integer keys internally and encrypt them at the API edge.

## Decision

Option 2. Public responses carry `encryptId(id)`: AES-256-GCM with a key derived by SHA-256 from `ID_ENCRYPTION_KEY`, a random 12-byte IV per call, and a 16-byte authentication tag, all base64url-encoded together. Incoming IDs go through `@DecryptId`, which returns 400 for anything that does not decrypt. Calls between services use the plain integers.

With encryption enabled, only a value the server itself produced is accepted. A plain number such as `5`, a tampered value, or a value encrypted with another key is rejected; the GCM tag makes forgery fail. An earlier version fell back to reading plain integers, which quietly defeated the point; that fallback is gone.

## Consequences

- Clients cannot enumerate records or learn row counts from IDs.
- The same record has a different public ID in every response (random IV). IDs cannot be compared by string or used as cache keys.
- `ID_ENCRYPTION_KEY` cannot change without invalidating every ID clients hold. The booking reference (10 characters from `crypto.randomInt`) is the stable public handle for a booking.
