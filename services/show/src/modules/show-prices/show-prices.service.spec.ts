import { Repository } from 'typeorm';
import { SeatType } from '@moviebooking/database';
import { Show, ShowPrice } from '../../entities';
import { ShowPricesService } from './show-prices.service';
import { TheatreClient } from '../../clients/theatre.client';
import {
  expectAppError,
  fakeDataSource,
  userWithRole,
} from '../../testing/test-helpers';

interface StoredPrice {
  id?: number;
  showId: number;
  seatType: SeatType;
  amount: number;
  currency: string;
}

function build(options: {
  screenSeatTypes: SeatType[];
  existing: StoredPrice[];
}) {
  let prices = [...options.existing];
  const removed: StoredPrice[] = [];
  const saved: StoredPrice[][] = [];

  const manager = {
    find: jest.fn(async () => prices),
    create: jest.fn((_entity: unknown, data: StoredPrice) => ({ ...data })),
    remove: jest.fn(async (rows: StoredPrice[]) => {
      removed.push(...rows);
      prices = prices.filter((p) => !rows.includes(p));
    }),
    save: jest.fn(async (rows: StoredPrice[]) => {
      saved.push(rows);
      for (const row of rows) if (!prices.includes(row)) prices.push(row);
      return rows;
    }),
  };
  const showRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 5, screenId: 1 }),
  };
  const theatreClient = {
    getScreen: jest.fn().mockResolvedValue({ id: 1, theatreId: 7 }),
    getScreenSeats: jest
      .fn()
      .mockResolvedValue(
        options.screenSeatTypes.map((seatType, i) => ({ id: i + 1, seatType })),
      ),
  };
  const service = new ShowPricesService(
    showRepository as unknown as Repository<Show>,
    {} as Repository<ShowPrice>,
    theatreClient as unknown as TheatreClient,
    fakeDataSource(manager),
  );
  return { service, manager, removed, saved, current: () => prices };
}

const admin = userWithRole('SUPER_ADMIN');

describe('ShowPricesService.setPrices', () => {
  it('returns 400 when a seat type on the screen has no price', async () => {
    const { service, manager } = build({
      screenSeatTypes: [SeatType.STANDARD, SeatType.VIP],
      existing: [],
    });

    const error = await expectAppError(
      service.setPrices(
        5,
        { prices: [{ seatType: SeatType.STANDARD, amount: 1000 }] },
        admin,
      ),
      400,
    );
    expect(error.message).toContain('VIP');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('updates existing prices, creates new ones and removes dropped seat types', async () => {
    const standard: StoredPrice = {
      id: 1,
      showId: 5,
      seatType: SeatType.STANDARD,
      amount: 900,
      currency: 'GBP',
    };
    const vip: StoredPrice = {
      id: 2,
      showId: 5,
      seatType: SeatType.VIP,
      amount: 1500,
      currency: 'GBP',
    };
    const { service, removed, current } = build({
      screenSeatTypes: [SeatType.STANDARD],
      existing: [standard, vip],
    });

    await service.setPrices(
      5,
      { prices: [{ seatType: SeatType.STANDARD, amount: 1100 }] },
      admin,
    );

    expect(removed).toEqual([vip]);
    expect(standard.amount).toBe(1100); // updated in place, keeping its ID
    expect(current()).toEqual([standard]);
  });

  it('creates prices for a show that has none', async () => {
    const { service, saved } = build({
      screenSeatTypes: [SeatType.STANDARD, SeatType.VIP],
      existing: [],
    });

    await service.setPrices(
      5,
      {
        prices: [
          { seatType: SeatType.STANDARD, amount: 1000 },
          { seatType: SeatType.VIP, amount: 1600, currency: 'EUR' },
        ],
      },
      admin,
    );

    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual([
      { showId: 5, seatType: SeatType.STANDARD, amount: 1000, currency: 'GBP' },
      { showId: 5, seatType: SeatType.VIP, amount: 1600, currency: 'EUR' },
    ]);
  });

  it('returns 403 to a theatre admin of another theatre', async () => {
    const { service } = build({
      screenSeatTypes: [SeatType.STANDARD],
      existing: [],
    });
    await expectAppError(
      service.setPrices(
        5,
        { prices: [{ seatType: SeatType.STANDARD, amount: 1000 }] },
        userWithRole('THEATRE_ADMIN', 8),
      ),
      403,
    );
  });
});
