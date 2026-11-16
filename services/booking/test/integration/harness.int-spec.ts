import { readIntegrationEnv } from './env';
import {
  TestContext,
  api,
  createTestApp,
  liveHoldsBySeat,
  resetBookings,
} from './harness';

/** Checks the harness itself: guard rail, migrations, seed data, reset. */
describe('integration harness', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(() => resetBookings(ctx));

  it('refuses a database whose name does not end in _test', () => {
    const original = process.env.TEST_DB_NAME;
    try {
      process.env.TEST_DB_NAME = 'moviebooking_db';
      expect(() => readIntegrationEnv()).toThrow('must end in "_test"');
    } finally {
      process.env.TEST_DB_NAME = original;
    }
  });

  it('ran every migration, including the live-hold unique index', async () => {
    const [index] = await ctx.dataSource.query(
      `SELECT filter_definition FROM sys.indexes
       WHERE name = 'idx_seat_holds_unique_live'`,
    );
    expect(index.filter_definition).toBe(
      "([status] IN ('ACTIVE', 'CONVERTED'))",
    );
  });

  it('seeded the show with five seats and serves a hold through the real stack', async () => {
    expect(ctx.fixture.seats.map((s) => s.seatCode)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
    ]);

    const res = await api.hold(ctx, ['A1', 'A5']);

    expect(res.status).toBe(201);
    expect(await liveHoldsBySeat(ctx)).toEqual({
      A1: ['ACTIVE'],
      A5: ['ACTIVE'],
    });
  });

  it('starts every test with no bookings', async () => {
    expect(await liveHoldsBySeat(ctx)).toEqual({});
  });
});
