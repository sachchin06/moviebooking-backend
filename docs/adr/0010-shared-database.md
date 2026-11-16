# 0010. One shared database, with tables owned per service

**Status:** accepted for now (database per service is on the [roadmap](../../ROADMAP.md))

## Context

A database per service is the textbook microservices choice. It also brings distributed data problems from the first day: no foreign keys across services, copies of data kept in sync through events, and migrations per service. For a small system built by one person, those costs arrive long before the benefits.

## Options

1. A database per service from the start.
2. One database, with each service owning a set of tables.

## Decision

Option 2. Every service connects to the same SQL Server database. Each service maps only its own tables and never joins another service's tables at runtime; it asks the owning service over REST instead. All migrations live in `libs/database`. Foreign keys are allowed across ownership boundaries (for example `bookings.show_id` → `shows.id`) because they keep the data consistent cheaply.

To make a later split easier, the booking service snapshots what it needs at the moment of booking (price and seat code per seat) instead of reading it back from other services.

## Consequences

- Simple operations, real referential integrity, and one place for migrations.
- The services are not independently deployable at the data level. A migration can affect several services, and one database is a shared point of failure and contention.
- The cross-service foreign keys must be removed before the database can be split.
