import {
  HoldData,
  TestContext,
  api,
  backdate,
  bookingStatus,
  createTestApp,
  liveHoldsBySeat,
  resetBookings,
} from './harness';

/**
 * Concurrency with every guard in place (Redis seat locks + the database index).
 *
 * How concurrency is produced: all requests in a round are started in the same tick
 * with Promise.all, so they reach the real HTTP server together. The server handles
 * them interleaved on every await (Redis, SQL Server), and the TypeORM pool has 30
 * connections, so up to 30 transactions are open on SQL Server at the same time.
 */
describe('concurrency (Redis available)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(() => resetBookings(ctx));

  it('20 concurrent holds on one seat: exactly one succeeds, 19 get 422, one ACTIVE hold', async () => {
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

  it('overlapping seat sets ([A1,A2], [A2,A3], [A3,A1]) never deadlock and never share a seat', async () => {
    for (let round = 0; round < 10; round++) {
      await resetBookings(ctx);

      const results = await Promise.all([
        api.hold(ctx, ['A1', 'A2'], 'a@example.com'),
        api.hold(ctx, ['A2', 'A3'], 'b@example.com'),
        api.hold(ctx, ['A3', 'A1'], 'c@example.com'),
      ]);

      // No 500 (a deadlock victim would surface as one); each request is 201 or 422.
      for (const r of results) expect([201, 422]).toContain(r.status);
      // Every pair shares a seat, so at most one request can win.
      expect(
        results.filter((r) => r.status === 201).length,
      ).toBeLessThanOrEqual(1);
      // And no seat is ever held twice.
      for (const holds of Object.values(await liveHoldsBySeat(ctx))) {
        expect(holds).toHaveLength(1);
      }
    }
  });

  describe('a confirm racing a new hold on the same seat', () => {
    async function pendingBooking(seat: string): Promise<string> {
      const held = await api.hold(ctx, [seat], 'first@example.com');
      expect(held.status).toBe(201);
      const ref = (held.body.data as HoldData).bookingRef;
      expect((await api.markPaymentPending(ctx, ref)).status).toBe(201);
      return ref;
    }

    it('within the deadline: the confirm wins, the new hold is refused, one live hold', async () => {
      for (let round = 0; round < 10; round++) {
        await resetBookings(ctx);
        const ref = await pendingBooking('A1');

        const [confirm, hold] = await Promise.all([
          api.confirm(ctx, ref),
          api.hold(ctx, ['A1'], 'second@example.com'),
        ]);

        expect(confirm.status).toBe(201);
        expect(hold.status).toBe(422);
        expect(await bookingStatus(ctx, ref)).toBe('CONFIRMED');
        expect(await liveHoldsBySeat(ctx)).toEqual({ A1: ['CONVERTED'] });
      }
    });

    it('past the deadline: whichever runs first, the seat never ends up with two holders', async () => {
      for (let round = 0; round < 10; round++) {
        await resetBookings(ctx);
        const ref = await pendingBooking('A1');
        await backdate(ctx, ref);

        const [, hold] = await Promise.all([
          api.confirm(ctx, ref),
          api.hold(ctx, ['A1'], 'second@example.com'),
        ]);

        // The late payment goes to review (or the booking was reclaimed as EXPIRED
        // first and the confirm was refused); either way it is not CONFIRMED.
        expect(['PENDING_REVIEW', 'EXPIRED']).toContain(
          await bookingStatus(ctx, ref),
        );
        expect(hold.status).toBe(201);
        expect(await liveHoldsBySeat(ctx)).toEqual({ A1: ['ACTIVE'] });
      }
    });
  });
});
