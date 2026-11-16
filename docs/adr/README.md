# Architecture decision records

Each record states the problem, the options considered, the decision, and what it costs. They describe the code as it is.

| # | Decision |
|---|---|
| [0001](0001-unique-index-on-live-holds.md) | A filtered unique index on live holds is the guarantee against double-booking |
| [0002](0002-redis-locks-fail-open.md) | Redis seat locks are a fast path that fails open |
| [0003](0003-stale-hold-reclaim-and-lock-ordering.md) | Expired holds are reclaimed by the next request, with a fixed lock order |
| [0004](0004-per-screen-applock-for-show-scheduling.md) | Show scheduling is serialised per screen with `sp_getapplock` |
| [0005](0005-row-locks-for-booking-transitions.md) | Booking transitions take a row lock, so cancel and confirm take turns |
| [0006](0006-fail-closed-on-dependency-failure.md) | Fail closed when another service cannot answer |
| [0007](0007-internal-api-key.md) | A shared internal API key, compared in constant time |
| [0008](0008-encrypted-public-ids.md) | Public IDs are encrypted with AES-256-GCM |
| [0009](0009-late-payment-to-pending-review.md) | A payment after the deadline goes to PENDING_REVIEW |
| [0010](0010-shared-database.md) | One shared database, with tables owned per service |
