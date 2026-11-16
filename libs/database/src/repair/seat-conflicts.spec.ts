import { DataSource, EntityManager } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { SeatHold } from '../entities/seat-hold.entity';
import { BookingStatus, SeatHoldStatus } from '../enums';
import {
  SeatClaim,
  applyRepair,
  findSeatClaims,
  formatPlan,
  planRepair,
  repairSeatConflicts,
} from './seat-conflicts';

let nextHold = 1;
function claim(
  bookingId: number,
  bookingStatus: BookingStatus,
  overrides: Partial<SeatClaim> = {},
): SeatClaim {
  return {
    holdId: nextHold++,
    showId: 1,
    seatId: 10,
    holdStatus:
      bookingStatus === BookingStatus.CONFIRMED
        ? SeatHoldStatus.RELEASED
        : SeatHoldStatus.ACTIVE,
    bookingId,
    bookingRef: `REF${bookingId}`,
    bookingStatus,
    ...overrides,
  };
}

describe('planRepair', () => {
  it('safe: one CONFIRMED claim keeps the seat, the others are expired', () => {
    const confirmed = claim(1, BookingStatus.CONFIRMED);
    const holding = claim(2, BookingStatus.HOLDING);
    const paying = claim(3, BookingStatus.PAYMENT_PENDING);

    const plan = planRepair([confirmed, holding, paying]);

    expect(plan.manual).toEqual([]);
    expect(plan.safe).toEqual([
      { showId: 1, seatId: 10, keep: confirmed, expire: [holding, paying] },
    ]);
  });

  it('manual: two CONFIRMED bookings on one seat is a double sale', () => {
    const plan = planRepair([
      claim(1, BookingStatus.CONFIRMED),
      claim(2, BookingStatus.CONFIRMED),
      claim(3, BookingStatus.HOLDING),
    ]);

    expect(plan.safe).toEqual([]);
    expect(plan.manual[0].reason).toMatch(/^DOUBLE_SALE: 2 confirmed/);
    expect(plan.manual[0].claims).toHaveLength(3);
  });

  it('manual: a paid PENDING_REVIEW claimant needs a person, not a script', () => {
    const plan = planRepair([
      claim(1, BookingStatus.CONFIRMED),
      claim(2, BookingStatus.PENDING_REVIEW),
    ]);
    expect(plan.manual[0].reason).toMatch(/^PAID_CLAIMANT/);
  });

  it('manual: no CONFIRMED booking to keep the seat', () => {
    const plan = planRepair([
      claim(1, BookingStatus.HOLDING),
      claim(2, BookingStatus.PAYMENT_PENDING),
    ]);
    expect(plan.manual[0].reason).toMatch(/^NO_CONFIRMED_OWNER/);
  });

  it('groups claims by show and seat independently', () => {
    const plan = planRepair([
      claim(1, BookingStatus.CONFIRMED, { seatId: 10 }),
      claim(2, BookingStatus.HOLDING, { seatId: 10 }),
      claim(3, BookingStatus.CONFIRMED, { seatId: 11 }),
      claim(4, BookingStatus.CONFIRMED, { seatId: 11 }),
    ]);
    expect(plan.safe.map((r) => r.seatId)).toEqual([10]);
    expect(plan.manual.map((r) => r.seatId)).toEqual([11]);
  });

  it('returns an empty plan when there are no conflicts', () => {
    expect(planRepair([])).toEqual({ safe: [], manual: [] });
  });
});

/** In-memory bookings and holds behind a minimal EntityManager. */
function fakeManager(
  bookings: { id: number; bookingRef: string; status: BookingStatus }[],
  holds: {
    id: number;
    bookingId: number;
    showId: number;
    seatId: number;
    status: SeatHoldStatus;
  }[],
) {
  const locked: number[] = [];
  const manager = {
    findOne: jest.fn(
      async (
        _e: unknown,
        options: { where: { id: number }; lock?: unknown },
      ) => {
        if (options.lock) locked.push(options.where.id);
        return bookings.find((b) => b.id === options.where.id) ?? null;
      },
    ),
    save: jest.fn(async (_e: unknown, value: unknown) => value),
    find: jest.fn(
      async (
        _e: unknown,
        options: { where: { bookingId: number; status: SeatHoldStatus } },
      ) =>
        holds.filter(
          (h) =>
            h.bookingId === options.where.bookingId &&
            h.status === options.where.status,
        ),
    ),
    update: jest.fn(
      async (
        _e: unknown,
        criteria: { bookingId: number; status: SeatHoldStatus },
        changes: { status: SeatHoldStatus },
      ) => {
        holds
          .filter(
            (h) =>
              h.bookingId === criteria.bookingId &&
              h.status === criteria.status,
          )
          .forEach((h) => (h.status = changes.status));
      },
    ),
    query: jest.fn(),
  };
  return {
    manager: manager as unknown as EntityManager & typeof manager,
    locked,
  };
}

describe('applyRepair', () => {
  it('expires losing bookings through the state machine, with all their active holds, in ID order', async () => {
    const bookings = [
      { id: 1, bookingRef: 'KEEP', status: BookingStatus.CONFIRMED },
      { id: 7, bookingRef: 'LATE', status: BookingStatus.PAYMENT_PENDING },
      { id: 4, bookingRef: 'HOLD', status: BookingStatus.HOLDING },
    ];
    const holds = [
      {
        id: 100,
        bookingId: 1,
        showId: 1,
        seatId: 10,
        status: SeatHoldStatus.RELEASED,
      },
      {
        id: 101,
        bookingId: 4,
        showId: 1,
        seatId: 10,
        status: SeatHoldStatus.ACTIVE,
      },
      {
        id: 102,
        bookingId: 4,
        showId: 1,
        seatId: 12,
        status: SeatHoldStatus.ACTIVE,
      },
      {
        id: 103,
        bookingId: 7,
        showId: 1,
        seatId: 10,
        status: SeatHoldStatus.ACTIVE,
      },
    ];
    const { manager, locked } = fakeManager(bookings, holds);
    const lines: string[] = [];
    const plan = planRepair([
      claim(1, BookingStatus.CONFIRMED, { holdId: 100 }),
      claim(7, BookingStatus.PAYMENT_PENDING, { holdId: 103 }),
      claim(4, BookingStatus.HOLDING, { holdId: 101 }),
    ]);

    const counts = await applyRepair(manager, plan, (l) => lines.push(l));

    expect(locked).toEqual([4, 7]);
    expect(bookings.map((b) => b.status)).toEqual([
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.EXPIRED,
    ]);
    // The whole losing booking expires, including its hold on another seat.
    expect(holds.map((h) => h.status)).toEqual([
      SeatHoldStatus.RELEASED,
      SeatHoldStatus.EXPIRED,
      SeatHoldStatus.EXPIRED,
      SeatHoldStatus.EXPIRED,
    ]);
    expect(counts).toEqual({ expiredBookings: 2, expiredHolds: 3 });
    expect(lines).toContain('booking HOLD (id 4): HOLDING -> EXPIRED');
    expect(lines).toContain('  hold 102 (show 1, seat 12): ACTIVE -> EXPIRED');
  });

  it('only expires the stale hold of a booking that is already terminal', async () => {
    const bookings = [
      { id: 5, bookingRef: 'OLD', status: BookingStatus.FAILED },
    ];
    const holds = [
      {
        id: 200,
        bookingId: 5,
        showId: 1,
        seatId: 10,
        status: SeatHoldStatus.ACTIVE,
      },
    ];
    const { manager } = fakeManager(bookings, holds);
    const lines: string[] = [];
    const plan = {
      safe: [
        {
          showId: 1,
          seatId: 10,
          keep: claim(1, BookingStatus.CONFIRMED),
          expire: [claim(5, BookingStatus.FAILED)],
        },
      ],
      manual: [],
    };

    const counts = await applyRepair(manager, plan, (l) => lines.push(l));

    expect(bookings[0].status).toBe(BookingStatus.FAILED);
    expect(holds[0].status).toBe(SeatHoldStatus.EXPIRED);
    expect(counts).toEqual({ expiredBookings: 0, expiredHolds: 1 });
    expect(lines[0]).toContain('stays FAILED');
  });

  it('skips a booking that no longer exists', async () => {
    const { manager } = fakeManager([], []);
    const plan = {
      safe: [
        {
          showId: 1,
          seatId: 10,
          keep: claim(1, BookingStatus.CONFIRMED),
          expire: [claim(9, BookingStatus.HOLDING)],
        },
      ],
      manual: [],
    };
    await expect(applyRepair(manager, plan, () => undefined)).resolves.toEqual({
      expiredBookings: 0,
      expiredHolds: 0,
    });
  });
});

describe('findSeatClaims', () => {
  it('queries claims on seats with more than one claim and normalises IDs to numbers', async () => {
    const { manager } = fakeManager([], []);
    manager.query.mockResolvedValue([
      {
        holdId: '1',
        showId: '2',
        seatId: '3',
        holdStatus: 'ACTIVE',
        bookingId: '4',
        bookingRef: 'R',
        bookingStatus: 'HOLDING',
      },
    ]);

    const claims = await findSeatClaims(manager);

    expect(claims).toEqual([
      {
        holdId: 1,
        showId: 2,
        seatId: 3,
        holdStatus: 'ACTIVE',
        bookingId: 4,
        bookingRef: 'R',
        bookingStatus: 'HOLDING',
      },
    ]);
    const sql = manager.query.mock.calls[0][0] as string;
    expect(sql).toContain("h.status IN ('ACTIVE', 'CONVERTED')");
    expect(sql).toContain("h.status = 'RELEASED' AND b.status = 'CONFIRMED'");
    expect(sql).toContain('claimCount > 1');
  });
});

describe('repairSeatConflicts', () => {
  function dataSourceWith(rows: object[]) {
    const bookings = [
      { id: 1, bookingRef: 'KEEP', status: BookingStatus.CONFIRMED },
      { id: 2, bookingRef: 'LOSE', status: BookingStatus.HOLDING },
    ];
    const holds = [
      {
        id: 11,
        bookingId: 2,
        showId: 1,
        seatId: 10,
        status: SeatHoldStatus.ACTIVE,
      },
    ];
    const { manager } = fakeManager(bookings, holds);
    manager.query.mockResolvedValue(rows);
    const dataSource = {
      transaction: jest.fn(
        async (work: (m: EntityManager) => Promise<unknown>) => work(manager),
      ),
    } as unknown as DataSource;
    return { dataSource, bookings, manager };
  }
  const conflict = [
    {
      holdId: 10,
      showId: 1,
      seatId: 10,
      holdStatus: 'RELEASED',
      bookingId: 1,
      bookingRef: 'KEEP',
      bookingStatus: 'CONFIRMED',
    },
    {
      holdId: 11,
      showId: 1,
      seatId: 10,
      holdStatus: 'ACTIVE',
      bookingId: 2,
      bookingRef: 'LOSE',
      bookingStatus: 'HOLDING',
    },
  ];

  it('dry run reports and changes nothing', async () => {
    const { dataSource, bookings, manager } = dataSourceWith(conflict);
    const lines: string[] = [];

    const result = await repairSeatConflicts(dataSource, {
      apply: false,
      log: (l) => lines.push(l),
    });

    expect(result).toMatchObject({ applied: false, expiredBookings: 0 });
    expect(result.plan.safe).toHaveLength(1);
    expect(bookings[1].status).toBe(BookingStatus.HOLDING);
    expect(manager.save).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('Dry run: nothing was changed');
  });

  it('--apply repairs the safe seats in the same transaction', async () => {
    const { dataSource, bookings } = dataSourceWith(conflict);
    const lines: string[] = [];

    const result = await repairSeatConflicts(dataSource, {
      apply: true,
      log: (l) => lines.push(l),
    });

    expect(result).toMatchObject({
      applied: true,
      expiredBookings: 1,
      expiredHolds: 1,
    });
    expect(bookings[1].status).toBe(BookingStatus.EXPIRED);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(lines.at(-1)).toBe('Done: 1 booking(s) and 1 hold(s) expired.');
  });

  it('--apply with nothing safe to repair says so and changes nothing', async () => {
    const { dataSource, manager } = dataSourceWith([]);
    const lines: string[] = [];

    const result = await repairSeatConflicts(dataSource, {
      apply: true,
      log: (l) => lines.push(l),
    });

    expect(result.applied).toBe(false);
    expect(manager.save).not.toHaveBeenCalled();
    expect(lines.at(-1)).toBe('Nothing safe to repair.');
  });
});

describe('formatPlan', () => {
  it('lists safe and manual seats with the bookings involved', () => {
    const lines = formatPlan(
      planRepair([
        claim(1, BookingStatus.CONFIRMED, { seatId: 10 }),
        claim(2, BookingStatus.HOLDING, { seatId: 10 }),
        claim(3, BookingStatus.CONFIRMED, { seatId: 11 }),
        claim(4, BookingStatus.CONFIRMED, { seatId: 11 }),
      ]),
    );

    expect(lines.slice(0, 3)).toEqual([
      'Seats with conflicting claims: 2',
      '  safe to repair: 1',
      '  needing manual review: 1',
    ]);
    expect(lines[3]).toMatch(/^SAFE {3}show 1 seat 10: keep REF1 \(CONFIRMED/);
    expect(lines[4]).toMatch(/^REVIEW show 1 seat 11: DOUBLE_SALE/);
  });
});

// Entity classes are only used as type tokens by the fakes above.
void Booking;
void SeatHold;
