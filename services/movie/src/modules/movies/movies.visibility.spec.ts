import { Repository } from 'typeorm';
import { ICurrentUser } from '@moviebooking/common';
import { Movie, MovieImage, MovieStatus } from '../../entities';
import { MoviesService } from './movies.service';
import { expectAppError, userWithRole } from '../../testing/test-helpers';

/** Records the WHERE clauses findAll builds; returns no rows. */
function build(movie?: Partial<Movie>) {
  const recorded: { clause: string; params?: Record<string, unknown> }[] = [];
  const qb: Record<string, unknown> = {};
  for (const method of ['where', 'andWhere']) {
    qb[method] = (clause: string, params?: Record<string, unknown>) => {
      recorded.push({ clause, params });
      return qb;
    };
  }
  for (const method of ['orderBy', 'addOrderBy', 'skip', 'take']) {
    qb[method] = () => qb;
  }
  qb.getManyAndCount = async () => [[], 0];

  const movieRepository = {
    createQueryBuilder: () => qb,
    findOne: jest.fn().mockResolvedValue(
      movie
        ? {
            id: 1,
            title: 'Film',
            releaseDate: new Date('2026-01-01'),
            images: [],
            ...movie,
          }
        : null,
    ),
  };
  const service = new MoviesService(
    movieRepository as unknown as Repository<Movie>,
    {} as Repository<MovieImage>,
  );
  return { service, recorded };
}

const guest = undefined;
const staff = userWithRole('STAFF');
const superAdmin = userWithRole('SUPER_ADMIN');
const theatreAdmin = userWithRole('THEATRE_ADMIN', 4);

describe('Movie visibility (business rule 4)', () => {
  describe('list', () => {
    it.each([
      ['a guest', guest],
      ['a theatre admin', theatreAdmin],
    ])('shows %s ACTIVE movies only', async (_label, user) => {
      const { service, recorded } = build();
      await service.findAll({}, user as ICurrentUser | undefined);
      expect(recorded[0]).toEqual({
        clause: 'movie.status = :status',
        params: { status: MovieStatus.ACTIVE },
      });
    });

    it.each([
      ['a guest', guest],
      ['a theatre admin', theatreAdmin],
    ])(
      'returns nothing to %s asking for INACTIVE movies',
      async (_label, user) => {
        const { service, recorded } = build();
        const page = await service.findAll(
          { status: MovieStatus.INACTIVE },
          user as ICurrentUser | undefined,
        );
        expect(page.data).toEqual([]);
        expect(recorded).toEqual([]);
      },
    );

    it.each([
      ['STAFF', staff],
      ['SUPER_ADMIN', superAdmin],
    ])('lets %s see every status, or filter by one', async (_label, user) => {
      const unfiltered = build();
      await unfiltered.service.findAll({}, user);
      expect(unfiltered.recorded.some((r) => r.clause.includes('status'))).toBe(
        false,
      );

      const filtered = build();
      await filtered.service.findAll({ status: MovieStatus.INACTIVE }, user);
      expect(filtered.recorded[0].params).toEqual({
        status: MovieStatus.INACTIVE,
      });
    });
  });

  describe('detail', () => {
    it.each([
      ['a guest', guest],
      ['a theatre admin', theatreAdmin],
    ])('returns 404 for an inactive movie to %s', async (_label, user) => {
      const { service } = build({ status: MovieStatus.INACTIVE });
      await expectAppError(
        service.findOne(1, user as ICurrentUser | undefined),
        404,
      );
    });

    it.each([
      ['STAFF', staff],
      ['SUPER_ADMIN', superAdmin],
    ])('shows an inactive movie to %s', async (_label, user) => {
      const { service } = build({ status: MovieStatus.INACTIVE });
      await expect(service.findOne(1, user)).resolves.toBeDefined();
    });

    it('shows an active movie to everyone', async () => {
      const { service } = build({ status: MovieStatus.ACTIVE });
      await expect(service.findOne(1)).resolves.toBeDefined();
    });
  });
});
