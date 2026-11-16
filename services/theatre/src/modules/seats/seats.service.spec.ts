import { Repository } from 'typeorm';
import { SeatType } from '@moviebooking/database';
import { Screen, Seat, SeatStatus } from '../../entities';
import { SeatsService } from './seats.service';
import { expectAppError, fakeDataSource } from '../../testing/test-helpers';

interface Options {
  existingSeatIds?: number[];
  saveError?: unknown;
}

function build(options: Options = {}) {
  const existing = (options.existingSeatIds ?? []).map((id) => ({
    id,
    screenId: 3,
    rowLabel: 'A',
    seatNumber: id,
    seatCode: `A${id}`,
    seatType: SeatType.STANDARD,
    status: SeatStatus.ACTIVE,
  }));
  const manager = {
    find: jest.fn(async () => existing),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (_entity: unknown, rows: object[]) => {
      if (options.saveError) throw options.saveError;
      return rows.map((r, i) => ({ id: i + 1, seatCode: 'X', ...r }));
    }),
  };
  const screenRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 3, theatreId: 7 }),
  };
  // bulkCreate uses a query runner directly; bulkUpdate uses dataSource.transaction.
  const queryRunner = {
    manager,
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  };
  const dataSource = Object.assign(fakeDataSource(manager), {
    createQueryRunner: () => queryRunner,
  });
  const service = new SeatsService(
    {} as Repository<Seat>,
    screenRepository as unknown as Repository<Screen>,
    dataSource,
  );
  return { service, manager, queryRunner };
}

describe('SeatsService bulk operations', () => {
  describe('bulkCreate', () => {
    const dto = {
      rowLabel: 'A',
      startNumber: 1,
      endNumber: 3,
      seatType: SeatType.VIP,
    };

    it('creates one seat per number in the range', async () => {
      const { service } = build();
      const result = await service.bulkCreate(7, 3, dto);
      expect(result.created).toBe(3);
    });

    it.each([2627, 2601])(
      'returns 409 with a clear message when SQL Server reports duplicate seat codes (%i)',
      async (number) => {
        const duplicate = Object.assign(
          new Error('Violation of UNIQUE KEY constraint'),
          {
            name: 'QueryFailedError',
            number,
          },
        );
        const { service, queryRunner } = build({ saveError: duplicate });

        const error = await expectAppError(
          service.bulkCreate(7, 3, dto),
          409,
          'DUPLICATE_RESOURCE',
        );
        expect(error.message).toContain('row A');
        expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      },
    );

    it('rethrows other database errors unchanged', async () => {
      const dbDown = Object.assign(new Error('connection lost'), {
        code: 'ECONNCLOSED',
      });
      const { service } = build({ saveError: dbDown });
      await expect(service.bulkCreate(7, 3, dto)).rejects.toBe(dbDown);
    });

    it('returns 400 for a reversed range', async () => {
      const { service } = build();
      await expectAppError(
        service.bulkCreate(7, 3, { ...dto, startNumber: 5, endNumber: 2 }),
        400,
      );
    });
  });

  describe('bulkUpdate', () => {
    it('updates the seat types', async () => {
      const { service, manager } = build({ existingSeatIds: [10, 11] });

      const result = await service.bulkUpdate(7, 3, {
        seats: [
          { id: '10', seatType: SeatType.VIP },
          { id: '11', seatType: SeatType.VIP },
        ],
      });

      expect(result.updated).toBe(2);
      const saved = manager.save.mock.calls[0][1] as { seatType: SeatType }[];
      expect(saved.every((s) => s.seatType === SeatType.VIP)).toBe(true);
    });

    it('returns 409 when the same seat appears twice', async () => {
      const { service, manager } = build({ existingSeatIds: [10] });

      await expectAppError(
        service.bulkUpdate(7, 3, {
          seats: [
            { id: '10', seatType: SeatType.VIP },
            { id: '10', seatType: SeatType.STANDARD },
          ],
        }),
        409,
        'DUPLICATE_RESOURCE',
      );
      expect(manager.find).not.toHaveBeenCalled();
    });

    it('returns 404 (not 500) when a seat is not on this screen', async () => {
      const { service, manager } = build({ existingSeatIds: [10] });

      await expectAppError(
        service.bulkUpdate(7, 3, {
          seats: [
            { id: '10', seatType: SeatType.VIP },
            { id: '99', seatType: SeatType.VIP },
          ],
        }),
        404,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
