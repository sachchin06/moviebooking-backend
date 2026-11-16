# Development guide

How to build, run and check the backend locally.

## Build order: libraries first

The services import `@moviebooking/common` and `@moviebooking/database` through each library's compiled `dist/` folder (`"main": "dist/index.js"`). `dist/` is not committed, so on a fresh clone **the libraries must be built before any service can build, start or run its tests**.

The root scripts handle this:

| Script | What it does |
|---|---|
| `npm run build` | Builds the libraries, then the services |
| `npm run build:libs` | Builds `libs/common` and `libs/database` only |
| `npm run build:services` | Builds every service (needs the libraries built) |

After changing anything under `libs/`, run `npm run build:libs` again before starting or testing a service.

## First-time set-up

```bash
npm ci
cp .env.example .env        # then fill in the secrets (DB_PASSWORD, JWT_*, ID_ENCRYPTION_KEY, INTERNAL_API_KEY, ADMIN_*)
docker compose up -d        # RabbitMQ and Redis (SQL Server runs locally, not in compose)
npm run build:libs
npm run db:migrate
```

## When migration M7 refuses to run: seat conflicts

Migration M7 (`M7ConvertedHolds`) creates the unique index that makes double-booking impossible: one live claim (an ACTIVE or CONVERTED hold) per seat per show. If existing data already has a seat claimed by more than one booking, **M7 refuses to run by design**. It lists the seats and changes nothing, because deciding who keeps a seat is a business decision, not a schema change.

Resolve those seats with the repair command, then run the migrations again:

```bash
npm run db:repair-seat-conflicts              # dry run: report only (the default)
npm run db:repair-seat-conflicts -- --apply   # repair the seats marked SAFE, in one transaction
npm run db:migrate
```

What the command decides, seat by seat:

| Situation | What `--apply` does |
|---|---|
| Exactly one CONFIRMED booking, plus holds from bookings that are not confirmed | **Safe.** The confirmed booking keeps the seat. Each other booking is expired through the booking state machine, together with all its active holds, as the expiry sweep would. |
| Two or more CONFIRMED bookings | **Nothing.** Listed for manual review: a real double sale, which needs a refund. |
| A PENDING_REVIEW booking (payment received) also claims the seat | **Nothing.** Listed for manual review. |
| No confirmed booking | **Nothing.** Listed for manual review. |

Every change is printed. Exit codes: `0` means done, `1` means an error (nothing changed), `2` means some seats still need manual review. M7 keeps refusing until those seats are resolved by hand.

Stop the booking service while you repair, so no new holds arrive in the middle.

## Running the services

Run each service in its own terminal:

```bash
npm run start:dev -w @moviebooking/identity-service
```

Each service reads only its own port variable:

| Service | Workspace | Port variable | Default |
|---|---|---|---|
| identity | `@moviebooking/identity-service` | `IDENTITY_SERVICE_PORT` | 3001 |
| theatre | `@moviebooking/theatre-service` | `THEATRE_SERVICE_PORT` | 3002 |
| movie | `@moviebooking/movie-service` | `MOVIE_SERVICE_PORT` | 3003 |
| show | `@moviebooking/show-service` | `SHOW_SERVICE_PORT` | 3004 |
| booking | `@moviebooking/booking-service` | `BOOKING_SERVICE_PORT` | 3005 |

## Checks (the same ones CI runs)

```bash
npm run lint:check   # ESLint without --fix (npm run lint applies fixes)
npm run typecheck    # tsc --noEmit in every package
npm test             # unit tests in every package
npm run test:cov     # unit tests with coverage
```

Line endings are LF everywhere (`.gitattributes`). Prettier is applied through ESLint; `npx prettier --write .` reformats the repository.

Unit tests enforce a coverage floor per package (`coverageThreshold` in each `package.json`); `npm run test:cov` fails if coverage drops below it.

## Integration tests (booking)

The booking service has an integration suite that runs the real booking code against a real SQL Server, Redis and RabbitMQ. Only the Show and Theatre HTTP clients are faked. It covers concurrent seat holds (with and without Redis), the full hold → payment → confirm flow including the RabbitMQ event, expiry and the sweep, and races between confirm, cancel and new holds.

### What it needs

| Dependency | Locally | Notes |
|---|---|---|
| SQL Server | Your local instance | A database whose name **ends in `_test`**. The suite drops and recreates it on every run, and refuses any other name. |
| Redis | `docker compose up -d redis` | Uses logical database 15 by default, so your development lock keys are untouched |
| RabbitMQ | `docker compose up -d rabbitmq` | Publishes to its own exchange (`booking.events.integration`) |

### Settings

Set these in your shell, or put them in a `.env.test` file at the repository root (git-ignored):

```dotenv
TEST_DB_HOST=localhost
TEST_DB_PORT=1433
TEST_DB_USERNAME=sa
TEST_DB_PASSWORD=<your SQL Server password>
TEST_DB_NAME=moviebooking_test
# Optional: TEST_DB_ENCRYPT (default false), TEST_DB_TRUST_SERVER_CERTIFICATE (default true)

TEST_REDIS_HOST=127.0.0.1
TEST_REDIS_PORT=6379
TEST_REDIS_PASSWORD=redis123          # the password in docker-compose.yml
# Optional: TEST_REDIS_DB (default 15)

TEST_RABBITMQ_URL=amqp://moviebooking:moviebooking123@127.0.0.1:5672
```

The SQL Server login needs permission to create and drop databases; the suite creates the `_test` database itself.

### Running

```bash
docker compose up -d redis rabbitmq
npm run build:libs                                   # the suite applies the compiled migrations
npm run test:int -w @moviebooking/booking-service
```

The run takes under a minute. It runs test files one at a time (`--runInBand`), because they share the database. Before the first test, it drops and recreates the test database and applies every migration. Between tests, it deletes all bookings and clears the Redis test database.

Test files end in `.int-spec.ts` and live in `services/booking/test/integration/`. `harness.ts` builds the app and has helpers for the API, database checks, backdating deadlines and consuming RabbitMQ events.

CI runs the same suite in the `integration` job, using service containers for SQL Server, Redis and RabbitMQ.
