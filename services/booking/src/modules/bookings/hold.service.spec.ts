import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  Booking,
  BookingStatus,
  SeatHold,
  SeatHoldStatus,
} from '@moviebooking/database';
import { BookingEventsPublisher } from '../../messaging/booking-events.publisher';
import { HoldService } from './hold.service';
import { ShowClient } from '../../clients/show.client';
import { TheatreClient } from '../../clients/theatre.client';
import {
  SeatLockContendedError,
  SeatLockService,
} from '../../redis/seat-lock.service';
import { BookingRefGenerator } from './booking-ref.generator';
import {
  defaultsOnlyConfig,
  expectAppError,
  fakeDataSource,
} from '../../testing/test-helpers';

// ID encryption is not initialised in these tests, so plain integers are valid IDs.
const SHOW = { id: 1, screenId: 5, movieId: 2, status: 'ACTIVE' };
const SEATS = [
  {
    id: 10,
    screenId: 5,
    seatCode: 'A1',
    rowLabel: 'A',
    seatNumber: 1,
    seatType: 'STANDARD',
    status: 'ACTIVE',
  },
  {
    id: 11,
    screenId: 5,
    seatCode: 'A2',
    rowLabel: 'A',
    seatNumber: 2,
    seatType: 'VIP',
    status: 'ACTIVE',
  },
];
const PRICES = [
  { id: 1, showId: 1, seatType: 'STANDARD', amount: 1000, currency: 'GBP' },
  { id: 2, showId: 1, seatType: 'VIP', amount: 1500, currency: 'GBP' },
];
const DTO = { showId: '1', seatIds: ['10', '11'], email: 'guest@example.com' };

/** A booking owning stale (expired) ACTIVE holds on the requested seats. */
interface StaleBooking {
  id: number;
  bookingRef: string;
  showId: number;
  status: BookingStatus;
  holdExpiresAt: Date | null;
  paymentExpiresAt: Date | null;
}

interface ManagerOptions {
  soldSeatIds?: number[];
  heldSeatIds?: number[];
  staleBookings?: StaleBooking[];
  holdSaveError?: unknown;
}

/** Minimal EntityManager covering what the hold transaction uses. */
function fakeManager(options: ManagerOptions = {}) {
  // Three queries hit seat_holds; their clauses say which one this is:
  // stale reclaim (expires_at <= now), sold (CONVERTED), currently held (ACTIVE).
  const queryBuilder = () => {
    let status: SeatHoldStatus | undefined;
    let stale = false;
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'select']) {
      qb[method] = jest.fn(
        (clause: string, params?: { status?: SeatHoldStatus }) => {
          if (params?.status) status = params.status;
          if (clause === 'h.expires_at <= :now') stale = true;
          return qb;
        },
      );
    }
    qb.getRawMany = jest.fn(async () => {
      if (stale) {
        return (options.staleBookings ?? []).map((b) => ({ bookingId: b.id }));
      }
      const seatIds =
        status === SeatHoldStatus.CONVERTED
          ? (options.soldSeatIds ?? [])
          : (options.heldSeatIds ?? []);
      return seatIds.map((seatId) => ({ seatId }));
    });
    return qb;
  };

  const lockOrder: number[] = [];
  return {
    lockOrder,
    createQueryBuilder: jest.fn(() => queryBuilder()),
    findOne: jest.fn(
      async (_entity: unknown, options2: { where: { id: number } }) => {
        lockOrder.push(options2.where.id);
        return (
          (options.staleBookings ?? []).find(
            (b) => b.id === options2.where.id,
          ) ?? null
        );
      },
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (entity: any) => {
      const isHoldBatch = Array.isArray(entity) && 'expiresAt' in entity[0];
      if (isHoldBatch && options.holdSaveError) throw options.holdSaveError;
      if (!Array.isArray(entity)) entity.id = 99;
      return entity;
    }),
  };
}

function buildService(managerOptions: ManagerOptions = {}) {
  const manager = fakeManager(managerOptions);
  const dataSource = fakeDataSource(manager);
  const showClient = {
    getShow: jest.fn().mockResolvedValue(SHOW),
    getPrices: jest.fn().mockResolvedValue(PRICES),
  };
  const theatreClient = {
    getScreenSeats: jest.fn().mockResolvedValue(SEATS),
  };
  const seatLockService = {
    acquire: jest.fn(async (showId: number, seatId: number) => ({
      key: `lock:seat:${showId}:${seatId}`,
      nonce: 'n',
      locked: true,
    })),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const bookingRefGenerator = {
    generateUniqueRef: jest.fn().mockResolvedValue('ABCDEFGHJK'),
  };
  const bookingRepo = {
    findOneOrFail: jest
      .fn()
      .mockResolvedValue({ id: 99, bookingRef: 'ABCDEFGHJK' }),
  };

  const eventsPublisher = {
    publishExpired: jest.fn().mockResolvedValue(undefined),
  };

  const service = new HoldService(
    dataSource,
    bookingRepo as unknown as Repository<Booking>,
    defaultsOnlyConfig as unknown as ConfigService,
    showClient as unknown as ShowClient,
    theatreClient as unknown as TheatreClient,
    seatLockService as unknown as SeatLockService,
    bookingRefGenerator as unknown as BookingRefGenerator,
    eventsPublisher as unknown as BookingEventsPublisher,
  );

  return {
    service,
    eventsPublisher,
    manager,
    dataSource,
    showClient,
    theatreClient,
    seatLockService,
  };
}

describe('HoldService', () => {
  describe('validation errors (before any lock or transaction)', () => {
    it('returns 400 for an invalid show ID', async () => {
      const { service, seatLockService } = buildService();
      await expectAppError(
        service.holdSeats({ ...DTO, showId: 'not-an-id' }),
        400,
      );
      expect(seatLockService.acquire).not.toHaveBeenCalled();
    });

    it('returns 400 when two seat IDs decrypt to the same seat', async () => {
      const { service } = buildService();
      await expectAppError(
        service.holdSeats({ ...DTO, seatIds: ['10', '010'] }),
        400,
      );
    });

    it('returns 404 when the show does not exist', async () => {
      const { service, showClient } = buildService();
      showClient.getShow.mockResolvedValue(null);
      await expectAppError(service.holdSeats(DTO), 404);
    });

    it('returns 422 when the show is not active', async () => {
      const { service, showClient } = buildService();
      showClient.getShow.mockResolvedValue({ ...SHOW, status: 'INACTIVE' });
      await expectAppError(service.holdSeats(DTO), 422);
    });

    it("returns 422 when a seat is not on the show's screen", async () => {
      const { service } = buildService();
      await expectAppError(
        service.holdSeats({ ...DTO, seatIds: ['10', '999'] }),
        422,
      );
    });

    it('returns 422 when a seat type has no price', async () => {
      const { service, showClient } = buildService();
      showClient.getPrices.mockResolvedValue([PRICES[0]]);
      await expectAppError(service.holdSeats(DTO), 422);
    });
  });

  describe('errors inside the hold transaction', () => {
    it('returns 422 (not 500) when a seat is already sold, and releases the locks', async () => {
      const { service, seatLockService } = buildService({ soldSeatIds: [10] });
      const error = await expectAppError(service.holdSeats(DTO), 422);
      expect(error.message).toContain('already sold');
      expect(seatLockService.release).toHaveBeenCalledTimes(2);
    });

    it('returns 422 (not 500) when a seat is currently held', async () => {
      const { service } = buildService({ heldSeatIds: [11] });
      const error = await expectAppError(service.holdSeats(DTO), 422);
      expect(error.message).toContain('currently held');
    });

    it('returns 422 when the filtered unique index rejects a duplicate hold', async () => {
      const duplicateKey = Object.assign(new Error('duplicate key'), {
        name: 'QueryFailedError',
        number: 2601,
      });
      const { service } = buildService({ holdSaveError: duplicateKey });
      const error = await expectAppError(service.holdSeats(DTO), 422);
      expect(error.message).toContain('already held');
    });

    it('rethrows unexpected database errors unchanged', async () => {
      const dbDown = Object.assign(new Error('connection lost'), {
        code: 'ECONNCLOSED',
      });
      const { service } = buildService({ holdSaveError: dbDown });
      await expect(service.holdSeats(DTO)).rejects.toBe(dbDown);
    });
  });

  it('returns 422 when another request holds the seat lock', async () => {
    const { service, seatLockService } = buildService();
    seatLockService.acquire.mockRejectedValueOnce(
      new SeatLockContendedError(1, 10),
    );
    await expectAppError(service.holdSeats(DTO), 422);
  });

  it('creates the booking in one transaction and releases every lock', async () => {
    const { service, dataSource, manager, seatLockService } = buildService();

    const booking = await service.holdSeats(DTO);

    expect(booking.bookingRef).toBe('ABCDEFGHJK');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // booking, booking_seats batch, seat_holds batch
    expect(manager.save).toHaveBeenCalledTimes(3);
    const bookingSeats = manager.save.mock.calls[1][0];
    expect(bookingSeats.map((s: any) => [s.seatCode, s.priceCents])).toEqual([
      ['A1', 1000],
      ['A2', 1500],
    ]);
    expect(seatLockService.acquire.mock.calls.map((c) => c[1])).toEqual([
      10, 11,
    ]);
    expect(seatLockService.release).toHaveBeenCalledTimes(2);
  });

  it('writes booking_seats and seat_holds in ascending seat ID order, whatever the request order', async () => {
    const { service, manager } = buildService();

    await service.holdSeats({ ...DTO, seatIds: ['11', '10'] });

    const seatIdsOf = (call: number) =>
      (manager.save.mock.calls[call][0] as { seatId: number }[]).map(
        (s) => s.seatId,
      );
    expect(seatIdsOf(1)).toEqual([10, 11]); // booking_seats
    expect(seatIdsOf(2)).toEqual([10, 11]); // seat_holds
  });

  describe('stale-hold reclaim', () => {
    const past = new Date(Date.now() - 60_000);
    const stale = (
      id: number,
      overrides: Partial<StaleBooking> = {},
    ): StaleBooking => ({
      id,
      bookingRef: `OLD000000${id}`,
      showId: 1,
      status: BookingStatus.HOLDING,
      holdExpiresAt: past,
      paymentExpiresAt: null,
      ...overrides,
    });

    it('expires bookings whose holds have run out, then creates the new hold', async () => {
      const old = stale(5);
      const { service, manager, eventsPublisher } = buildService({
        staleBookings: [old],
      });

      await service.holdSeats(DTO);

      expect(old.status).toBe(BookingStatus.EXPIRED);
      expect(manager.update).toHaveBeenCalledWith(
        SeatHold,
        { bookingId: 5, status: SeatHoldStatus.ACTIVE },
        { status: SeatHoldStatus.EXPIRED },
      );
      expect(eventsPublisher.publishExpired).toHaveBeenCalledWith({
        bookingRef: 'OLD0000005',
        showId: 1,
      });
    });

    it('locks the stale bookings in ascending ID order', async () => {
      const { service, manager } = buildService({
        staleBookings: [stale(9), stale(3), stale(7)],
      });

      await service.holdSeats(DTO);

      expect(manager.lockOrder).toEqual([3, 7, 9]);
    });

    it('leaves a booking alone if, under its lock, it is no longer overdue', async () => {
      // e.g. it moved to PAYMENT_PENDING with a later deadline after the read.
      const paying = stale(5, {
        status: BookingStatus.PAYMENT_PENDING,
        paymentExpiresAt: new Date(Date.now() + 60_000),
      });
      const { service, manager, eventsPublisher } = buildService({
        staleBookings: [paying],
      });

      await service.holdSeats(DTO);

      expect(paying.status).toBe(BookingStatus.PAYMENT_PENDING);
      expect(manager.update).not.toHaveBeenCalled();
      expect(eventsPublisher.publishExpired).not.toHaveBeenCalled();
    });

    it('publishes nothing when the hold itself fails', async () => {
      const { service, eventsPublisher } = buildService({
        staleBookings: [stale(5)],
        soldSeatIds: [10],
      });

      await expectAppError(service.holdSeats(DTO), 422);
      expect(eventsPublisher.publishExpired).not.toHaveBeenCalled();
    });
  });
});
