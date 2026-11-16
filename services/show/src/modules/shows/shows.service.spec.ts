import { Brackets, Repository } from 'typeorm';
import { AppException } from '@moviebooking/common';
import { Show, ShowPrice, ShowStatus } from '../../entities';
import { ShowsService } from './shows.service';
import { TheatreClient } from '../../clients/theatre.client';
import { MovieClient } from '../../clients/movie.client';
import { BookingClient } from '../../clients/booking.client';
import {
  expectAppError,
  fakeDataSource,
  userWithRole,
} from '../../testing/test-helpers';

const HOUR = 60 * 60 * 1000;
const base = Date.now() + 48 * HOUR; // comfortably in the future
const at = (hours: number) => new Date(base + hours * HOUR);

interface StoredShow {
  id: number;
  screenId: number;
  movieId: number;
  startsAt: Date;
  endsAt: Date;
  status: ShowStatus;
}

/**
 * Query builder that evaluates the overlap query's WHERE clauses against in-memory
 * shows. Each clause the service uses has a JavaScript twin; an unknown clause throws,
 * so changing the SQL without updating this fake fails the tests loudly.
 */
function overlapQueryBuilder(shows: StoredShow[]) {
  const evaluators: Record<
    string,
    (s: StoredShow, p: Record<string, unknown>) => boolean
  > = {
    'show.screenId = :screenId': (s, p) => s.screenId === p.screenId,
    'show.status = :status': (s, p) => s.status === p.status,
    'show.startsAt < :endsAt': (s, p) => s.startsAt < (p.endsAt as Date),
    'show.endsAt > :startsAt': (s, p) => s.endsAt > (p.startsAt as Date),
    'show.id != :excludeShowId': (s, p) => s.id !== p.excludeShowId,
  };
  const filters: ((s: StoredShow) => boolean)[] = [];
  const qb = {
    where: (clause: string, params: Record<string, unknown>) =>
      add(clause, params),
    andWhere: (clause: string, params: Record<string, unknown>) =>
      add(clause, params),
    getOne: async () => shows.find((s) => filters.every((f) => f(s))) ?? null,
  };
  function add(clause: string, params: Record<string, unknown>) {
    const evaluate = evaluators[clause];
    if (!evaluate) throw new Error(`Unmapped overlap clause: ${clause}`);
    filters.push((s) => evaluate(s, params));
    return qb;
  }
  return qb;
}

interface BuildOptions {
  shows?: StoredShow[];
  lockResult?: number;
  hasBookings?: boolean | Error;
}

function build(options: BuildOptions = {}) {
  const shows = options.shows ?? [];
  const calls: string[] = [];

  const manager = {
    query: jest.fn(async (_sql: string, params: unknown[]) => {
      calls.push(`lock ${params[0]}`);
      return [{ result: options.lockResult ?? 0 }];
    }),
    createQueryBuilder: jest.fn(() => {
      calls.push('overlap check');
      return overlapQueryBuilder(shows);
    }),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (a: unknown, b?: unknown) => {
      calls.push('save');
      const entity = (b ?? a) as StoredShow;
      entity.id = entity.id ?? 100;
      return entity;
    }),
  };

  const showRepository = {
    findOne: jest.fn(
      async ({ where }: { where: { id: number } }) =>
        shows.find((s) => s.id === where.id) ?? null,
    ),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const theatreClient = {
    getScreen: jest.fn(async (id: number) => ({
      id,
      theatreId: 7,
      name: 'S',
      status: 'ACTIVE',
    })),
    getScreenIdsByTheatre: jest.fn().mockResolvedValue([1, 2]),
    getTheatre: jest.fn().mockResolvedValue(null),
  };
  const movieClient = {
    getMovie: jest.fn().mockResolvedValue({ id: 3, status: 'ACTIVE' }),
  };
  const bookingClient = {
    hasLiveBookings: jest.fn(async () => {
      if (options.hasBookings instanceof Error) throw options.hasBookings;
      return options.hasBookings ?? false;
    }),
  };
  const showPriceRepository = { find: jest.fn().mockResolvedValue([]) };

  const service = new ShowsService(
    showRepository as unknown as Repository<Show>,
    showPriceRepository as unknown as Repository<ShowPrice>,
    theatreClient as unknown as TheatreClient,
    movieClient as unknown as MovieClient,
    bookingClient as unknown as BookingClient,
    fakeDataSource(manager),
  );
  return {
    service,
    manager,
    showRepository,
    bookingClient,
    theatreClient,
    calls,
  };
}

const existing = (overrides: Partial<StoredShow> = {}): StoredShow => ({
  id: 10,
  screenId: 1,
  movieId: 3,
  startsAt: at(2),
  endsAt: at(4),
  status: ShowStatus.ACTIVE,
  ...overrides,
});

const createDto = (startsAt: Date, endsAt: Date, screenId = '1') => ({
  movieId: '3',
  screenId,
  startsAt: startsAt.toISOString(),
  endsAt: endsAt.toISOString(),
});

const superAdmin = userWithRole('SUPER_ADMIN');

describe('ShowsService', () => {
  describe('overlap check', () => {
    it.each([
      ['ends exactly when the existing show starts', at(0), at(2)],
      ['starts exactly when the existing show ends', at(4), at(6)],
    ])('allows a show that %s (touching intervals)', async (_l, s, e) => {
      const { service, manager } = build({ shows: [existing()] });
      await service.create(createDto(s, e), superAdmin);
      expect(manager.save).toHaveBeenCalled();
    });

    it.each([
      ['overlaps the start', at(1), at(3)],
      ['overlaps the end', at(3), at(5)],
      ['sits inside', at(2.5), at(3.5)],
      ['covers it entirely', at(1), at(5)],
      ['matches it exactly', at(2), at(4)],
    ])('rejects a show that %s with 409', async (_l, s, e) => {
      const { service, manager } = build({ shows: [existing()] });
      await expectAppError(
        service.create(createDto(s, e), superAdmin),
        409,
        'DUPLICATE_RESOURCE',
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('ignores inactive shows and shows on other screens', async () => {
      const { service, manager } = build({
        shows: [
          existing({ status: ShowStatus.INACTIVE }),
          existing({ id: 11, screenId: 2 }),
        ],
      });
      await service.create(createDto(at(2), at(4)), superAdmin);
      expect(manager.save).toHaveBeenCalled();
    });

    it('excludes the show itself when its time is updated', async () => {
      const show = existing();
      const { service, manager } = build({ shows: [show] });

      await service.update(
        show.id,
        { startsAt: at(2.5).toISOString() },
        superAdmin,
      );

      expect(manager.save).toHaveBeenCalled();
      expect(show.startsAt).toEqual(at(2.5));
    });

    it('still rejects an update that overlaps a different show', async () => {
      const show = existing();
      const other = existing({ id: 11, startsAt: at(5), endsAt: at(7) });
      const { service } = build({ shows: [show, other] });

      await expectAppError(
        service.update(show.id, { endsAt: at(6).toISOString() }, superAdmin),
        409,
      );
    });

    it('checks overlap when an inactive show is reactivated', async () => {
      const inactive = existing({ id: 12, status: ShowStatus.INACTIVE });
      const { service } = build({ shows: [inactive, existing()] });

      await expectAppError(
        service.update(inactive.id, { status: ShowStatus.ACTIVE }, superAdmin),
        409,
      );
    });
  });

  describe('concurrency (per-screen schedule lock)', () => {
    it('takes the screen lock before the overlap check and the insert', async () => {
      const { service, calls } = build();
      await service.create(createDto(at(0), at(1), '5'), superAdmin);
      expect(calls).toEqual([
        'lock show-schedule:screen:5',
        'overlap check',
        'save',
      ]);
    });

    it('returns 409 CONFLICT when the lock cannot be taken, without checking or saving', async () => {
      const { service, calls } = build({ lockResult: -1 });

      await expectAppError(
        service.create(createDto(at(0), at(1)), superAdmin),
        409,
        'CONFLICT',
      );
      expect(calls).toEqual(['lock show-schedule:screen:1']);
    });

    it('locks for a time change on update', async () => {
      const show = existing();
      const { service, calls } = build({ shows: [show] });
      await service.update(
        show.id,
        { endsAt: at(4.5).toISOString() },
        superAdmin,
      );
      expect(calls[0]).toBe('lock show-schedule:screen:1');
    });

    it('does not lock when only an active show is deactivated', async () => {
      const show = existing();
      const { service, manager } = build({ shows: [show] });
      await service.update(
        show.id,
        { status: ShowStatus.INACTIVE },
        superAdmin,
      );
      expect(manager.query).not.toHaveBeenCalled();
      expect(show.status).toBe(ShowStatus.INACTIVE);
    });
  });

  describe('live bookings', () => {
    it('returns 409 when changing the time of a show with bookings', async () => {
      const show = existing();
      const { service, manager } = build({ shows: [show], hasBookings: true });

      await expectAppError(
        service.update(show.id, { startsAt: at(1).toISOString() }, superAdmin),
        409,
        'CONFLICT',
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns 409 when deleting a show with bookings', async () => {
      const show = existing();
      const { service, showRepository } = build({
        shows: [show],
        hasBookings: true,
      });

      await expectAppError(
        service.delete(show.id, superAdmin),
        409,
        'CONFLICT',
      );
      expect(showRepository.softDelete).not.toHaveBeenCalled();
    });

    it('returns 503 (never a silent allow) when the Booking Service is down', async () => {
      const show = existing();
      const down = new AppException('SERVICE_UNAVAILABLE');
      const { service, showRepository, manager } = build({
        shows: [show],
        hasBookings: down,
      });

      await expectAppError(service.delete(show.id, superAdmin), 503);
      await expectAppError(
        service.update(show.id, { endsAt: at(5).toISOString() }, superAdmin),
        503,
      );
      expect(showRepository.softDelete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('deletes a show without bookings', async () => {
      const show = existing();
      const { service, showRepository } = build({ shows: [show] });
      await service.delete(show.id, superAdmin);
      expect(showRepository.softDelete).toHaveBeenCalledWith(show.id);
    });

    it('does not ask the Booking Service when only the status changes', async () => {
      const show = existing();
      const { service, bookingClient } = build({ shows: [show] });
      await service.update(
        show.id,
        { status: ShowStatus.INACTIVE },
        superAdmin,
      );
      expect(bookingClient.hasLiveBookings).not.toHaveBeenCalled();
    });
  });

  describe('visibility (business rule 4)', () => {
    /** Records how findAll builds its query; returns no rows. */
    function listQueryBuilder() {
      const recorded: { method: string; arg: unknown; params?: unknown }[] = [];
      const qb: Record<string, unknown> = {};
      for (const method of ['where', 'andWhere']) {
        qb[method] = (arg: unknown, params?: unknown) => {
          recorded.push({ method, arg, params });
          return qb;
        };
      }
      qb.orderBy = () => qb;
      qb.skip = () => qb;
      qb.take = () => qb;
      qb.getManyAndCount = async () => [[], 0];
      return { qb, recorded };
    }

    function buildForList() {
      const built = build();
      const { qb, recorded } = listQueryBuilder();
      (
        built.showRepository as unknown as Record<string, unknown>
      ).createQueryBuilder = () => qb;
      return { ...built, recorded };
    }

    it('shows guests ACTIVE shows only', async () => {
      const { service, recorded } = buildForList();
      await service.findAll({});
      expect(recorded[0]).toMatchObject({
        arg: 'show.status = :active',
        params: { active: ShowStatus.ACTIVE },
      });
    });

    it('returns nothing to a guest asking for INACTIVE shows', async () => {
      const { service, recorded } = buildForList();
      const page = await service.findAll({ status: ShowStatus.INACTIVE });
      expect(page.data).toEqual([]);
      expect(recorded).toEqual([]);
    });

    it('lets STAFF filter by any status', async () => {
      const { service, recorded } = buildForList();
      await service.findAll(
        { status: ShowStatus.INACTIVE },
        userWithRole('STAFF'),
      );
      expect(recorded[0]).toMatchObject({
        params: { status: ShowStatus.INACTIVE },
      });
    });

    it("shows a theatre admin ACTIVE shows plus their own theatre's screens", async () => {
      const { service, recorded, theatreClient } = buildForList();
      await service.findAll({}, userWithRole('THEATRE_ADMIN', 7));
      expect(theatreClient.getScreenIdsByTheatre).toHaveBeenCalledWith(7);
      expect(recorded[0].arg).toBeInstanceOf(Brackets);
    });

    it("limits a theatre admin's INACTIVE filter to their own screens", async () => {
      const { service, recorded } = buildForList();
      await service.findAll(
        { status: ShowStatus.INACTIVE },
        userWithRole('THEATRE_ADMIN', 7),
      );
      expect(recorded[1]).toMatchObject({
        arg: 'show.screenId IN (:...ownScreenIds)',
        params: { ownScreenIds: [1, 2] },
      });
    });

    it('returns 404 for an inactive show to a guest', async () => {
      const { service } = build({
        shows: [existing({ status: ShowStatus.INACTIVE })],
      });
      await expectAppError(service.findOne(10), 404);
    });

    it("shows an inactive show to the theatre admin of the show's theatre only", async () => {
      const { service } = build({
        shows: [existing({ status: ShowStatus.INACTIVE })],
      });
      // The fake theatre client puts every screen in theatre 7.
      await expect(
        service.findOne(10, userWithRole('THEATRE_ADMIN', 7)),
      ).resolves.toBeDefined();
      await expectAppError(
        service.findOne(10, userWithRole('THEATRE_ADMIN', 8)),
        404,
      );
    });
  });
});
