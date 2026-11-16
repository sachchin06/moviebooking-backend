import {
  HoldData,
  TestContext,
  api,
  backdate,
  bookingStatus,
  consumeEvents,
  createTestApp,
  liveHoldsBySeat,
  resetBookings,
  runSweep,
} from './harness';

const refOf = (res: { body: { data?: unknown } }) =>
  (res.body.data as HoldData).bookingRef;

async function seatStatuses(ctx: TestContext): Promise<Record<string, string>> {
  const res = await api.availability(ctx);
  expect(res.status).toBe(200);
  const seats = (
    res.body.data as { seats: { seatCode: string; status: string }[] }
  ).seats;
  return Object.fromEntries(seats.map((s) => [s.seatCode, s.status]));
}

describe('booking flows', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(() => resetBookings(ctx));

  it('hold → mark-payment-pending → confirm: seats SOLD, holds CONVERTED, booking.confirmed published with real seat codes', async () => {
    const events = await consumeEvents(ctx, 'booking.confirmed');
    try {
      const held = await api.hold(ctx, ['A1', 'A5']);
      expect(held.status).toBe(201);
      const ref = refOf(held);

      expect((await api.markPaymentPending(ctx, ref)).status).toBe(201);
      const confirmed = await api.confirm(ctx, ref);
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.status).toBe('CONFIRMED');

      expect(await seatStatuses(ctx)).toEqual({
        A1: 'SOLD',
        A2: 'AVAILABLE',
        A3: 'AVAILABLE',
        A4: 'AVAILABLE',
        A5: 'SOLD',
      });
      expect(await liveHoldsBySeat(ctx)).toEqual({
        A1: ['CONVERTED'],
        A5: ['CONVERTED'],
      });

      const [event] = await events.waitFor(1);
      expect(event).toMatchObject({
        bookingRef: ref,
        email: 'guest@example.com',
        totalAmountCents: 2500,
        currency: 'GBP',
      });
      expect(
        (event.seats as { seatCode: string }[]).map((s) => s.seatCode).sort(),
      ).toEqual(['A1', 'A5']);

      // A sold seat cannot be held again.
      expect((await api.hold(ctx, ['A1'], 'late@example.com')).status).toBe(
        422,
      );
    } finally {
      await events.close();
    }
  });

  it('an expired hold is reclaimed at once: the new hold succeeds and the old booking is EXPIRED', async () => {
    const first = await api.hold(ctx, ['A2'], 'first@example.com');
    const oldRef = refOf(first);
    await backdate(ctx, oldRef); // "move time" past the hold's expiry

    // No sweep has run: the new hold must reclaim the stale hold itself.
    const second = await api.hold(ctx, ['A2'], 'second@example.com');

    expect(second.status).toBe(201);
    expect(await bookingStatus(ctx, oldRef)).toBe('EXPIRED');
    expect(await liveHoldsBySeat(ctx)).toEqual({ A2: ['ACTIVE'] });
    const [old] = await ctx.dataSource.query(
      `SELECT h.status FROM seat_holds h JOIN bookings b ON b.id = h.booking_id
       WHERE b.booking_ref = @0`,
      [oldRef],
    );
    expect(old.status).toBe('EXPIRED');
  });

  it('the sweep expires overdue HOLDING and PAYMENT_PENDING bookings and frees their seats', async () => {
    const holding = refOf(await api.hold(ctx, ['A3'], 'holding@example.com'));
    const paying = refOf(await api.hold(ctx, ['A4'], 'paying@example.com'));
    expect((await api.markPaymentPending(ctx, paying)).status).toBe(201);
    await backdate(ctx, holding);
    await backdate(ctx, paying);

    await runSweep(ctx);

    expect(await bookingStatus(ctx, holding)).toBe('EXPIRED');
    expect(await bookingStatus(ctx, paying)).toBe('EXPIRED');
    expect(await liveHoldsBySeat(ctx)).toEqual({});
    const seats = await seatStatuses(ctx);
    expect([seats.A3, seats.A4]).toEqual(['AVAILABLE', 'AVAILABLE']);
  });

  it('cancel racing mark-payment-pending + confirm: exactly one wins and a confirmed booking is never overwritten', async () => {
    for (let round = 0; round < 10; round++) {
      await resetBookings(ctx);
      const ref = refOf(await api.hold(ctx, ['A1']));

      const [cancel, confirm] = await Promise.all([
        api.cancel(ctx, ref),
        (async () => {
          const pending = await api.markPaymentPending(ctx, ref);
          return pending.status === 201 ? api.confirm(ctx, ref) : pending;
        })(),
      ]);

      const cancelWon = cancel.status === 200;
      const confirmWon =
        confirm.status === 201 && confirm.body.status === 'CONFIRMED';
      expect(cancelWon !== confirmWon).toBe(true); // exactly one

      const status = await bookingStatus(ctx, ref);
      expect(status).toBe(confirmWon ? 'CONFIRMED' : 'FAILED');

      if (confirmWon) {
        // A later cancel must not touch the confirmed booking.
        expect((await api.cancel(ctx, ref)).status).toBe(422);
        expect(await bookingStatus(ctx, ref)).toBe('CONFIRMED');
        expect(await liveHoldsBySeat(ctx)).toEqual({ A1: ['CONVERTED'] });
      } else {
        expect(await liveHoldsBySeat(ctx)).toEqual({});
      }
    }
  });
});
