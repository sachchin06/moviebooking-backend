import {
  TestContext,
  api,
  createTestApp,
  liveHoldsBySeat,
  resetBookings,
} from './harness';

/**
 * The same contention with Redis unreachable. The seat-lock service fails open, so
 * nothing serialises the requests before the database: the filtered unique index on
 * seat_holds is the only guard left.
 */
describe('concurrency (Redis unavailable: the database index is the guard)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ redisAvailable: false });
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(() => resetBookings(ctx));

  it('20 concurrent holds on one seat: still exactly one success and one ACTIVE hold', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api.hold(ctx, ['A1'], `guest${i}@example.com`),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 422)).toHaveLength(19);
    expect(await liveHoldsBySeat(ctx)).toEqual({ A1: ['ACTIVE'] });
  });

  // 30 rounds: before seats were inserted in ascending order this failed with a
  // deadlock about once in 60 requests.
  it('overlapping seat sets without Redis: no 500s and no seat held twice', async () => {
    for (let round = 0; round < 30; round++) {
      await resetBookings(ctx);

      const results = await Promise.all([
        api.hold(ctx, ['A1', 'A2'], 'a@example.com'),
        api.hold(ctx, ['A2', 'A3'], 'b@example.com'),
        api.hold(ctx, ['A3', 'A1'], 'c@example.com'),
      ]);

      for (const r of results) expect([201, 422]).toContain(r.status);
      expect(
        results.filter((r) => r.status === 201).length,
      ).toBeLessThanOrEqual(1);
      for (const holds of Object.values(await liveHoldsBySeat(ctx))) {
        expect(holds).toHaveLength(1);
      }
    }
  });
});
