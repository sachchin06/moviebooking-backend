import { FindOperator, Repository } from 'typeorm';
import { Show, ShowPrice, ShowStatus } from '../../entities';
import { InternalService } from './internal.service';

describe('InternalService.hasFutureShows', () => {
  it('looks for ACTIVE shows starting after now on the given screens', async () => {
    const showRepository = { exists: jest.fn().mockResolvedValue(true) };
    const service = new InternalService(
      showRepository as unknown as Repository<Show>,
      {} as Repository<ShowPrice>,
    );

    await expect(service.hasFutureShows([3, 4])).resolves.toEqual({
      exists: true,
    });

    const where = showRepository.exists.mock.calls[0][0].where;
    expect(where.status).toBe(ShowStatus.ACTIVE);
    expect(where.screenId).toBeInstanceOf(FindOperator);
    expect(where.screenId.value).toEqual([3, 4]);
    expect(where.startsAt.type).toBe('moreThan');
    expect(where.startsAt.value.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
