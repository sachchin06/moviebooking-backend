import { Repository } from 'typeorm';
import {
  Movie,
  MovieRequest,
  MovieRequestStatus,
  MovieStatus,
} from '../../entities';
import { MovieRequestsService } from './movie-requests.service';
import {
  expectAppError,
  fakeDataSource,
  userWithRole,
} from '../../testing/test-helpers';

function makeRequest(status = MovieRequestStatus.PENDING) {
  return {
    id: 6,
    theatreId: 4,
    requestedByUserId: 2,
    title: 'Dune: Part Three',
    description: 'Sand',
    releaseDate: new Date('2027-03-01'),
    expectedReleaseDate: null,
    cast: null,
    director: 'D. V.',
    language: 'English',
    notes: null,
    status,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    createdMovieId: null,
    createdAt: new Date(),
  } as unknown as MovieRequest;
}

function build(
  request: MovieRequest | null,
  options: { movieSaveError?: Error } = {},
) {
  const order: string[] = [];
  const manager = {
    findOne: jest.fn(async () => {
      order.push('lock request');
      return request;
    }),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (entity: unknown, value: { id?: number }) => {
      if (entity === Movie) {
        order.push('save movie');
        if (options.movieSaveError) throw options.movieSaveError;
        return { ...value, id: 77 };
      }
      order.push('save request');
      return value;
    }),
  };
  const dataSource = fakeDataSource(manager);
  const service = new MovieRequestsService(
    {} as Repository<MovieRequest>,
    {} as Repository<Movie>,
    dataSource,
  );
  return { service, manager, dataSource, order };
}

const reviewer = userWithRole('STAFF');
const review = { reviewReason: 'Looks good' };

describe('MovieRequestsService approve/reject', () => {
  it('approve: locks the request, creates the movie and marks the request APPROVED in one transaction', async () => {
    const request = makeRequest();
    const { service, manager, dataSource, order } = build(request);

    const result = await service.approve(6, review, reviewer);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['lock request', 'save movie', 'save request']);
    expect(manager.findOne).toHaveBeenCalledWith(MovieRequest, {
      where: { id: 6 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.create).toHaveBeenCalledWith(
      Movie,
      expect.objectContaining({
        title: 'Dune: Part Three',
        status: MovieStatus.ACTIVE,
      }),
    );
    expect(request.status).toBe(MovieRequestStatus.APPROVED);
    expect(request.createdMovieId).toBe(77);
    expect(request.reviewedByUserId).toBe(reviewer.id);
    expect(result.createdMovie?.title).toBe('Dune: Part Three');
  });

  it('approve: a failure creating the movie leaves the request unchanged (rolled back)', async () => {
    const request = makeRequest();
    const { service, order } = build(request, {
      movieSaveError: new Error('db'),
    });

    await expect(service.approve(6, review, reviewer)).rejects.toThrow('db');
    expect(order).not.toContain('save request');
    expect(request.status).toBe(MovieRequestStatus.PENDING);
  });

  it('reject: locks the request and marks it REJECTED', async () => {
    const request = makeRequest();
    const { service, manager } = build(request);

    await service.reject(6, review, reviewer);

    expect(manager.findOne).toHaveBeenCalledWith(
      MovieRequest,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(request.status).toBe(MovieRequestStatus.REJECTED);
    expect(request.reviewReason).toBe('Looks good');
  });

  describe.each([
    ['approve', (s: MovieRequestsService) => s.approve(6, review, reviewer)],
    ['reject', (s: MovieRequestsService) => s.reject(6, review, reviewer)],
  ])('%s', (_name, act) => {
    it.each([MovieRequestStatus.APPROVED, MovieRequestStatus.REJECTED])(
      'returns 422 for a request that is already %s (second reviewer)',
      async (status) => {
        const { service, manager } = build(makeRequest(status));
        await expectAppError(act(service), 422);
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for an unknown request', async () => {
      const { service } = build(null);
      await expectAppError(act(service), 404);
    });
  });
});
