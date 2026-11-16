import { repairSeatConflicts } from '@moviebooking/database';
import { TestContext, createTestApp, resetBookings } from './harness';

/**
 * The seat-conflict repair command (libs/database) against real SQL Server.
 *
 * Conflicts cannot exist while idx_seat_holds_unique_live is in place, which is the
 * point of migration M7. To reproduce the pre-M7 data the command exists for, this
 * test drops the index, plants conflicts, and recreates the index afterwards.
 */
describe('seat-conflict repair command (real database)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await resetBookings(ctx);
    await ctx.dataSource.query(
      `DROP INDEX IF EXISTS idx_seat_holds_unique_live ON seat_holds`,
    );
  });

  afterEach(async () => {
    await resetBookings(ctx);
    await ctx.dataSource.query(`
      CREATE UNIQUE INDEX idx_seat_holds_unique_live
      ON seat_holds (show_id, seat_id) WHERE status IN ('ACTIVE', 'CONVERTED')`);
  });

  /** Inserts a booking with one hold per seat code; returns the booking ID. */
  async function plant(
    ref: string,
    status: string,
    holdStatus: string,
    seatCodes: string[],
  ): Promise<number> {
    const [booking] = await ctx.dataSource.query(
      `INSERT INTO bookings (booking_ref, show_id, email, status, total_amount_cents, hold_expires_at)
       OUTPUT INSERTED.id
       VALUES (@0, @1, 'planted@example.com', @2, 1000, DATEADD(minute, 5, SYSUTCDATETIME()))`,
      [ref, ctx.fixture.showId, status],
    );
    for (const code of seatCodes) {
      await ctx.dataSource.query(
        `INSERT INTO seat_holds (booking_id, show_id, seat_id, status, expires_at)
         VALUES (@0, @1, @2, @3, DATEADD(minute, 5, SYSUTCDATETIME()))`,
        [booking.id, ctx.fixture.showId, ctx.seat(code), holdStatus],
      );
    }
    return booking.id;
  }

  async function statuses(): Promise<Record<string, string>> {
    const rows: { booking_ref: string; status: string }[] =
      await ctx.dataSource.query(`SELECT booking_ref, status FROM bookings`);
    return Object.fromEntries(rows.map((r) => [r.booking_ref, r.status]));
  }

  async function holdStatuses(ref: string): Promise<string[]> {
    const rows: { status: string }[] = await ctx.dataSource.query(
      `SELECT h.status FROM seat_holds h JOIN bookings b ON b.id = h.booking_id
       WHERE b.booking_ref = @0 ORDER BY h.id`,
      [ref],
    );
    return rows.map((r) => r.status);
  }

  async function plantScenario() {
    // A1: sold to KEEP (pre-M7: confirmed holds were RELEASED) and also held by HOLD,
    // which holds A2 as well. Safe: KEEP keeps A1, HOLD expires (both its seats).
    await plant('KEEP000001', 'CONFIRMED', 'RELEASED', ['A1']);
    await plant('HOLD000001', 'HOLDING', 'ACTIVE', ['A1', 'A2']);
    // A3: sold twice. A real double sale: must be left for a person.
    await plant('SOLD000001', 'CONFIRMED', 'RELEASED', ['A3']);
    await plant('SOLD000002', 'CONFIRMED', 'CONVERTED', ['A3']);
  }

  it('dry run reports both seats and changes nothing', async () => {
    await plantScenario();
    const before = await statuses();
    const lines: string[] = [];

    const result = await repairSeatConflicts(ctx.dataSource, {
      apply: false,
      log: (l) => lines.push(l),
    });

    expect(result.plan.safe).toHaveLength(1);
    expect(result.plan.manual).toHaveLength(1);
    expect(result.plan.manual[0].reason).toMatch(/^DOUBLE_SALE/);
    expect(await statuses()).toEqual(before);
    expect(await holdStatuses('HOLD000001')).toEqual(['ACTIVE', 'ACTIVE']);
    expect(lines.join('\n')).toContain('Dry run: nothing was changed');
  });

  it('--apply expires the losing booking and leaves the double sale untouched', async () => {
    await plantScenario();
    const lines: string[] = [];

    const result = await repairSeatConflicts(ctx.dataSource, {
      apply: true,
      log: (l) => lines.push(l),
    });

    expect(result).toMatchObject({
      applied: true,
      expiredBookings: 1,
      expiredHolds: 2,
    });
    expect(await statuses()).toEqual({
      KEEP000001: 'CONFIRMED',
      HOLD000001: 'EXPIRED',
      SOLD000001: 'CONFIRMED',
      SOLD000002: 'CONFIRMED',
    });
    // The whole losing reservation expired, including its other seat (A2).
    expect(await holdStatuses('HOLD000001')).toEqual(['EXPIRED', 'EXPIRED']);
    expect(await holdStatuses('KEEP000001')).toEqual(['RELEASED']);
    expect(lines).toContain(
      'booking HOLD000001 (id ' +
        lines.join('').match(/HOLD000001 \(id (\d+)/)?.[1] +
        '): HOLDING -> EXPIRED',
    );

    // Running again finds only the seat that needs a person.
    const again = await repairSeatConflicts(ctx.dataSource, {
      apply: true,
      log: () => undefined,
    });
    expect(again.plan.safe).toHaveLength(0);
    expect(again.plan.manual.map((m) => m.seatId)).toEqual([ctx.seat('A3')]);
  });
});
