# Roadmap

What is finished, and what comes next in the order I plan to build it. Each milestone is small enough for one or two working sessions and ends with a check that can be run, not a feeling.

## Done

| Milestone | Result |
|---|---|
| Stabilise booking | Business errors return their real status (404/409/422), never a 500 from a double rollback. `booking.confirmed` carries real seat codes. Guest cancel locks the row and needs the booking email. |
| Repository hygiene and CI | LF line endings, Prettier, `lint:check`, libraries built before services, GitHub Actions for lint, type-check and unit tests with coverage thresholds |
| Secure internal traffic | Every `/internal` route needs a shared key, compared in constant time. Encrypted IDs no longer accept plain integers. Unknown errors no longer leak their message. |
| Core service refactors | Show scheduling serialised per screen with `sp_getapplock`. Shows with bookings cannot be moved or deleted. Theatres and screens with future shows cannot be deactivated. Login gives one generic error. `mustChangePassword` is enforced in every service. |
| Double-booking guarantee | One filtered unique index covers both reserved (ACTIVE) and sold (CONVERTED) holds. Expired holds are reclaimed by the next request. A repair command handles conflicting legacy data. |
| Integration tests | The booking service runs against real SQL Server, Redis and RabbitMQ, locally and in CI. Concurrency, races, expiry and the full flow are covered. |

## Next

### 1. Payment service

**Goal:** a booking can be paid for, using Stripe Checkout in test mode.

- `POST /api/payments/checkout { bookingRef }` calls the booking service's `mark-payment-pending` and creates a Checkout session.
- A webhook endpoint verifies Stripe's signature, records each event in a `payments` table with a unique `stripe_event_id`, and calls `confirm` or `fail` on the booking service.
- A late payment already moves a booking to `PENDING_REVIEW`; the payment service records the refund that is then needed.

**Done when:** with the Stripe CLI forwarding webhooks, a test card takes a booking from HOLDING to CONFIRMED, and replaying the same webhook event changes nothing.

### 2. Reliable events (transactional outbox)

**Goal:** an event is never lost because RabbitMQ was briefly unavailable.

- The booking service writes each event to an `outbox` table in the same transaction as the state change.
- A relay publishes unsent rows and marks them as sent.
- Consumers ignore an event ID they have already processed.

**Done when:** stopping RabbitMQ during a confirm and starting it again still delivers `booking.confirmed` exactly once to a test consumer.

### 3. Notification service

**Goal:** a guest receives their ticket by email.

- Consumes `booking.confirmed`, with a processed-event table so a redelivered message is not handled twice.
- Generates a ticket with a QR code containing the booking reference.
- Sends it through an email provider; Mailpit locally.

**Done when:** a confirmed booking produces exactly one email with the ticket, and redelivering the message does not send a second.

### 4. The whole system with one command

**Goal:** `docker compose up` starts everything a reviewer needs.

- A multi-stage Dockerfile per service (the libraries are built first).
- SQL Server, a migration job and all five services added to `docker-compose.yml`.
- Health endpoints (`@nestjs/terminus`: database, Redis, RabbitMQ), so Compose starts each service only when its dependencies are healthy.

**Done when:** on a clean machine, `docker compose up` followed by a smoke script completes the journey browse → hold → confirm.

### 5. Auth hardening

**Goal:** sessions can be ended, and the public endpoints resist abuse.

- Refresh tokens stored as hashes and rotated on use; logout revokes them.
- Rate limiting (`@nestjs/throttler` backed by Redis) on login and on `POST /bookings/hold`.

**Done when:** tests show that a revoked refresh token is refused, a rotated token cannot be used twice, and the limit returns 429.

### 6. Guest booking UI

**Goal:** the booking flow can be used in a browser.

- Browse movies → choose a show → seat map with live availability → hold with a countdown → pay → booking status page.
- Built in the existing Next.js app (`moviebooking-web-admin` is still an empty shell today).

**Done when:** the full journey works in a browser against the composed stack.

### 7. Observability

**Goal:** one request can be followed across services.

- A correlation ID passed on every call between services (the services already read `x-request-id`), and structured JSON logs.
- Metrics for hold contention, lock waits and expiry-sweep throughput.

**Done when:** a single booking can be traced through every service's logs by one ID, and a dashboard shows hold success and failure rates.

### 8. Per-service identity for internal calls

**Goal:** replace the single shared internal key, so one leaked key no longer opens every service.

- Each service gets its own identity: mutual TLS between services, or short-lived signed service tokens.
- Each internal endpoint accepts only the services that need it; for example, only the payment service may call `confirm`.

**Done when:** a call from the wrong service to `POST /internal/bookings/:ref/confirm` is refused, and rotating one service's credentials does not affect the others.

### 9. Database per service

**Goal:** remove the shared database, so services can be deployed, scaled and changed independently.

- Each service owns its tables in its own database. The foreign keys that cross service boundaries today (for example `bookings.show_id` to `shows.id`) are replaced by IDs checked through the owning service or through events.
- Data each service needs from another (show times, seat codes, prices) is copied in through events or snapshotted at write time, as booking already does with seat codes and prices.

**Done when:** each service starts with only its own database connection, and the integration suite passes with the databases split.
