import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as amqp from 'amqplib';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import {
  HttpExceptionFilter,
  TransformInterceptor,
} from '@moviebooking/common';
import {
  Booking,
  BookingSeat,
  SeatHold,
  createSqlServerOptions,
} from '@moviebooking/database';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AvailabilityModule } from '../../src/modules/availability/availability.module';
import { BookingsModule } from '../../src/modules/bookings/bookings.module';
import { InternalModule } from '../../src/modules/internal/internal.module';
import { HoldSweepService } from '../../src/modules/bookings/hold-sweep.service';
import { RedisModule } from '../../src/redis/redis.module';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { MessagingModule } from '../../src/messaging/messaging.module';
import { ShowClient } from '../../src/clients/show.client';
import { TheatreClient } from '../../src/clients/theatre.client';
import { IntegrationEnv, readIntegrationEnv, testDbReader } from './env';

export const INTERNAL_KEY = 'integration-internal-key';
export const EXCHANGE = 'booking.events.integration';

export interface Fixture {
  theatreId: number;
  screenId: number;
  movieId: number;
  showId: number;
  seats: { id: number; seatCode: string; seatType: 'STANDARD' | 'VIP' }[];
}

export interface TestContext {
  app: INestApplication;
  baseUrl: string;
  dataSource: DataSource;
  redis: Redis;
  env: IntegrationEnv;
  fixture: Fixture;
  /** Seat ID for seat code "A1" … "A5". */
  seat(code: string): number;
  close(): Promise<void>;
}

const PRICES = { STANDARD: 1000, VIP: 1500 };

/**
 * Builds the real booking application (controllers, services, TypeORM on SQL Server,
 * Redis seat locks, RabbitMQ publisher) with only the Show and Theatre HTTP clients
 * replaced by fakes that answer from the seeded reference data.
 */
export async function createTestApp(
  options: { redisAvailable?: boolean } = {},
): Promise<TestContext> {
  const env = readIntegrationEnv();

  // Configuration the booking modules read through ConfigService (process.env).
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: 'integration-jwt-secret',
    INTERNAL_API_KEY: INTERNAL_KEY,
    RABBITMQ_URL: env.rabbitmqUrl,
    RABBITMQ_BOOKING_EXCHANGE: EXCHANGE,
    HOLD_LIFETIME_MINUTES: '5',
    PAYMENT_WINDOW_MINUTES: '10',
    MAX_RESERVATION_MINUTES: '15',
    SEAT_LOCK_TTL_SECONDS: '8',
    SEAT_LOCK_WAIT_MS: '500',
  });
  delete process.env.RABBITMQ_USER;
  delete process.env.RABBITMQ_PASSWORD;

  // Filled in once the reference data is seeded (the fakes read it lazily).
  const state: { fixture?: Fixture } = {};
  const current = (): Fixture => {
    if (!state.fixture) throw new Error('Reference data not seeded yet');
    return state.fixture;
  };

  const showClient = {
    getShow: async (id: number) =>
      state.fixture && id === state.fixture.showId
        ? {
            id,
            screenId: state.fixture.screenId,
            movieId: state.fixture.movieId,
            startsAt: '2030-01-01T18:00:00.000Z',
            endsAt: '2030-01-01T20:00:00.000Z',
            status: 'ACTIVE',
          }
        : null,
    getPrices: async (id: number) =>
      state.fixture && id === state.fixture.showId
        ? Object.entries(PRICES).map(([seatType, amount], i) => ({
            id: i + 1,
            showId: id,
            seatType,
            amount,
            currency: 'GBP',
          }))
        : null,
    getShowIdsByScreens: async () => [current().showId],
  };
  const theatreClient = {
    getScreen: async (id: number) =>
      state.fixture && id === state.fixture.screenId
        ? {
            id,
            theatreId: state.fixture.theatreId,
            name: 'Screen 1',
            status: 'ACTIVE',
          }
        : null,
    getScreenSeats: async (screenId: number) =>
      state.fixture && screenId === state.fixture.screenId
        ? state.fixture.seats.map((s, i) => ({
            id: s.id,
            screenId,
            seatCode: s.seatCode,
            rowLabel: 'A',
            seatNumber: i + 1,
            seatType: s.seatType,
            status: 'ACTIVE',
          }))
        : null,
    getScreensByTheatre: async () => [current().screenId],
  };

  // Redis: the real server (own logical DB), or a client pointing at a closed port
  // so every lock attempt fails and the seat-lock service fails open.
  const redis =
    options.redisAvailable === false
      ? new Redis({
          host: '127.0.0.1',
          port: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          retryStrategy: () => null,
        })
      : new Redis({
          host: env.redis.host,
          port: env.redis.port,
          password: env.redis.password,
          db: env.redis.db,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
  redis.on('error', () => undefined);
  if (options.redisAvailable !== false) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Redis did not become ready')),
        10_000,
      );
      redis.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await redis.flushdb();
  }

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      TypeOrmModule.forRoot({
        ...createSqlServerOptions(testDbReader(env), {
          entities: [Booking, BookingSeat, SeatHold],
        }),
        logging: false,
        // Enough connections for the concurrency tests to really run in parallel.
        pool: { max: 30, min: 0 },
      }),
      AuthModule,
      AvailabilityModule,
      BookingsModule,
      InternalModule,
      RedisModule,
      MessagingModule,
    ],
  })
  class IntegrationAppModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationAppModule],
  })
    .overrideProvider(ShowClient)
    .useValue(showClient)
    .overrideProvider(TheatreClient)
    .useValue(theatreClient)
    .overrideProvider(REDIS_CLIENT)
    .useValue(redis)
    .compile();

  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  await app.listen(0);

  const dataSource = app.get(DataSource);
  state.fixture = await seedReferenceData(dataSource);

  return {
    app,
    baseUrl: (await app.getUrl()).replace('[::1]', 'localhost'),
    dataSource,
    redis,
    env,
    get fixture() {
      return current();
    },
    seat(code: string) {
      const found = current().seats.find((s) => s.seatCode === code);
      if (!found) throw new Error(`No seat ${code}`);
      return found.id;
    },
    async close() {
      await app.close();
      redis.disconnect();
    },
  };
}

/** Clears every table the suite writes to, then inserts fresh reference data. */
export async function seedReferenceData(ds: DataSource): Promise<Fixture> {
  await ds.query(`
    DELETE FROM seat_holds; DELETE FROM booking_seats; DELETE FROM bookings;
    DELETE FROM show_prices; DELETE FROM shows; DELETE FROM seats;
    DELETE FROM screens; DELETE FROM theatre_admins; DELETE FROM theatres;
    DELETE FROM movie_requests; DELETE FROM movie_images; DELETE FROM movies;
  `);
  const [theatre] = await ds.query(
    `INSERT INTO theatres (name, city, address, status) OUTPUT INSERTED.id
     VALUES ('Integration Cinema', 'Leeds', '1 Test Street', 'ACTIVE')`,
  );
  const [screen] = await ds.query(
    `INSERT INTO screens (theatre_id, name, status) OUTPUT INSERTED.id
     VALUES (@0, 'Screen 1', 'ACTIVE')`,
    [theatre.id],
  );
  const seats: Fixture['seats'] = [];
  for (let n = 1; n <= 5; n++) {
    const seatType = n === 5 ? 'VIP' : 'STANDARD';
    const [seat] = await ds.query(
      `INSERT INTO seats (screen_id, seat_code, row_label, seat_number, seat_type, status)
       OUTPUT INSERTED.id VALUES (@0, @1, 'A', @2, @3, 'ACTIVE')`,
      [screen.id, `A${n}`, n, seatType],
    );
    seats.push({ id: seat.id, seatCode: `A${n}`, seatType });
  }
  const [movie] = await ds.query(
    `INSERT INTO movies (title, release_date, status) OUTPUT INSERTED.id
     VALUES ('Integration Film', '2026-01-01', 'ACTIVE')`,
  );
  const [show] = await ds.query(
    `INSERT INTO shows (screen_id, movie_id, starts_at, ends_at, status) OUTPUT INSERTED.id
     VALUES (@0, @1, '2030-01-01T18:00:00', '2030-01-01T20:00:00', 'ACTIVE')`,
    [screen.id, movie.id],
  );
  for (const [seatType, amount] of Object.entries(PRICES)) {
    await ds.query(
      `INSERT INTO show_prices (show_id, seat_type, amount, currency) VALUES (@0, @1, @2, 'GBP')`,
      [show.id, seatType, amount],
    );
  }
  return {
    theatreId: theatre.id,
    screenId: screen.id,
    movieId: movie.id,
    showId: show.id,
    seats,
  };
}

/** Removes all bookings and lock keys, keeping the reference data. */
export async function resetBookings(ctx: TestContext): Promise<void> {
  await ctx.dataSource.query(
    `DELETE FROM seat_holds; DELETE FROM booking_seats; DELETE FROM bookings;`,
  );
  if (ctx.redis.status === 'ready') {
    await ctx.redis.flushdb();
  }
}

// ---------- HTTP helpers (the real controllers, pipes and filters) ----------

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: { success: boolean; data?: T; error?: { code: string } } & T;
}

async function call<T>(
  ctx: TestContext,
  method: string,
  path: string,
  body?: unknown,
  internal = false,
): Promise<ApiResult<T>> {
  const res = await fetch(`${ctx.baseUrl}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(internal ? { 'X-Internal-Key': INTERNAL_KEY } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as ApiResult<T>['body'],
  };
}

export interface HoldData {
  bookingRef: string;
  status: string;
}

export const api = {
  hold: (ctx: TestContext, seatCodes: string[], email = 'guest@example.com') =>
    call<HoldData>(ctx, 'POST', '/bookings/hold', {
      showId: String(ctx.fixture.showId),
      seatIds: seatCodes.map((code) => String(ctx.seat(code))),
      email,
    }),
  cancel: (ctx: TestContext, ref: string, email = 'guest@example.com') =>
    call(ctx, 'POST', `/bookings/${ref}/cancel`, { email }),
  // Internal routes skip the response envelope: the body is the raw result.
  markPaymentPending: (ctx: TestContext, ref: string) =>
    call<{ status: string }>(
      ctx,
      'POST',
      `/internal/bookings/${ref}/mark-payment-pending`,
      {},
      true,
    ),
  confirm: (ctx: TestContext, ref: string) =>
    call<{ status: string }>(
      ctx,
      'POST',
      `/internal/bookings/${ref}/confirm`,
      {},
      true,
    ),
  availability: (ctx: TestContext) =>
    call<{ seats: { seatCode: string; status: string }[] }>(
      ctx,
      'GET',
      `/shows/${ctx.fixture.showId}/seats/availability`,
    ),
};

/** Runs the expiry sweep once, as the cron job would. */
export function runSweep(ctx: TestContext): Promise<void> {
  return ctx.app.get(HoldSweepService).sweepExpiredReservations();
}

// ---------- database inspection ----------

export async function liveHoldsBySeat(
  ctx: TestContext,
): Promise<Record<string, string[]>> {
  const rows: { seat_code: string; status: string }[] =
    await ctx.dataSource.query(
      `SELECT s.seat_code, h.status FROM seat_holds h
     JOIN seats s ON s.id = h.seat_id
     WHERE h.status IN ('ACTIVE', 'CONVERTED')`,
    );
  const result: Record<string, string[]> = {};
  for (const r of rows) (result[r.seat_code] ??= []).push(r.status);
  return result;
}

export async function bookingStatus(
  ctx: TestContext,
  ref: string,
): Promise<string> {
  const [row] = await ctx.dataSource.query(
    `SELECT status FROM bookings WHERE booking_ref = @0`,
    [ref],
  );
  return row?.status;
}

/** "Moves time" for one booking by putting its deadlines in the past. */
export async function backdate(
  ctx: TestContext,
  ref: string,
  minutes = 30,
): Promise<void> {
  await ctx.dataSource.query(
    `DECLARE @past datetime2 = DATEADD(minute, -@1, SYSUTCDATETIME());
     UPDATE bookings SET hold_expires_at = @past,
       payment_expires_at = CASE WHEN payment_expires_at IS NULL THEN NULL ELSE @past END,
       created_at = DATEADD(minute, -60, @past)
     WHERE booking_ref = @0;
     UPDATE h SET h.expires_at = @past FROM seat_holds h
     JOIN bookings b ON b.id = h.booking_id WHERE b.booking_ref = @0;`,
    [ref, minutes],
  );
}

// ---------- RabbitMQ ----------

export interface EventConsumer {
  messages: Record<string, unknown>[];
  waitFor(
    count: number,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/** Binds a private queue to the booking exchange and collects matching events. */
export async function consumeEvents(
  ctx: TestContext,
  routingKey: string,
): Promise<EventConsumer> {
  const connection = await amqp.connect(ctx.env.rabbitmqUrl);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  const { queue } = await channel.assertQueue('', {
    exclusive: true,
    autoDelete: true,
  });
  await channel.bindQueue(queue, EXCHANGE, routingKey);

  const messages: Record<string, unknown>[] = [];
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    messages.push(JSON.parse(msg.content.toString()));
    channel.ack(msg);
  });

  return {
    messages,
    async waitFor(count, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (messages.length < count && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return messages;
    },
    async close() {
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
    },
  };
}
