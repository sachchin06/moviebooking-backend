import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { Repository } from 'typeorm';
import { AppException } from '@moviebooking/common';
import {
  Screen,
  ScreenStatus,
  Seat,
  Theatre,
  TheatreStatus,
} from '../entities';
import { ShowClient } from '../clients/show.client';
import { TheatresService } from './theatres/theatres.service';
import { ScreensService } from './screens/screens.service';
import { expectAppError } from '../testing/test-helpers';

/** Show client stand-in: true/false, or an error to simulate an outage. */
function showClientAnswering(answer: boolean | Error) {
  return {
    hasFutureShows: jest.fn(async (screenIds: number[]) => {
      if (answer instanceof Error) throw answer;
      return screenIds.length > 0 && answer;
    }),
  };
}

function buildTheatres(answer: boolean | Error, screenIds = [1, 2]) {
  const theatre = {
    id: 4,
    name: 'Odeon',
    city: 'Leeds',
    address: '1 St',
    status: TheatreStatus.ACTIVE,
  };
  const theatreRepository = {
    findOne: jest.fn().mockResolvedValue(theatre),
    save: jest.fn(async (t: object) => t),
  };
  const screenRepository = {
    find: jest.fn().mockResolvedValue(screenIds.map((id) => ({ id }))),
  };
  const showClient = showClientAnswering(answer);
  const service = new TheatresService(
    theatreRepository as unknown as Repository<Theatre>,
    screenRepository as unknown as Repository<Screen>,
    showClient as unknown as ShowClient,
  );
  return { service, theatre, theatreRepository, showClient };
}

function buildScreens(answer: boolean | Error) {
  const screen = {
    id: 3,
    theatreId: 4,
    name: 'Screen 1',
    status: ScreenStatus.ACTIVE,
  };
  const screenRepository = {
    findOne: jest.fn().mockResolvedValue(screen),
    save: jest.fn(async (s: object) => s),
  };
  const showClient = showClientAnswering(answer);
  const service = new ScreensService(
    screenRepository as unknown as Repository<Screen>,
    {} as Repository<Theatre>,
    {} as Repository<Seat>,
    showClient as unknown as ShowClient,
  );
  return { service, screen, screenRepository, showClient };
}

const outage = new AppException('SERVICE_UNAVAILABLE');

describe('Deactivating a theatre', () => {
  it.each([
    ['DELETE', (s: TheatresService) => s.remove(4)],
    [
      'PATCH status=INACTIVE',
      (s: TheatresService) => s.update(4, { status: TheatreStatus.INACTIVE }),
    ],
  ])(
    '%s returns 409 while its screens have future shows',
    async (_label, act) => {
      const { service, theatreRepository, showClient } = buildTheatres(true);

      await expectAppError(act(service), 409, 'CONFLICT');
      expect(showClient.hasFutureShows).toHaveBeenCalledWith([1, 2]);
      expect(theatreRepository.save).not.toHaveBeenCalled();
    },
  );

  it('returns 503 and changes nothing when the Show Service is down', async () => {
    const { service, theatreRepository } = buildTheatres(outage);
    await expectAppError(service.remove(4), 503);
    expect(theatreRepository.save).not.toHaveBeenCalled();
  });

  it('deactivates a theatre with no future shows', async () => {
    const { service, theatre } = buildTheatres(false);
    await service.remove(4);
    expect(theatre.status).toBe(TheatreStatus.INACTIVE);
  });

  it('deactivates a theatre that has no screens', async () => {
    const { service, theatre } = buildTheatres(true, []);
    await service.remove(4);
    expect(theatre.status).toBe(TheatreStatus.INACTIVE);
  });

  it('does not ask the Show Service for other updates', async () => {
    const { service, showClient } = buildTheatres(true);
    await service.update(4, { name: 'Odeon Leeds' });
    expect(showClient.hasFutureShows).not.toHaveBeenCalled();
  });
});

describe('Deactivating a screen', () => {
  it.each([
    ['DELETE', (s: ScreensService) => s.remove(4, 3)],
    [
      'PATCH status=INACTIVE',
      (s: ScreensService) => s.update(4, 3, { status: ScreenStatus.INACTIVE }),
    ],
  ])('%s returns 409 while it has future shows', async (_label, act) => {
    const { service, screenRepository, showClient } = buildScreens(true);

    await expectAppError(act(service), 409, 'CONFLICT');
    expect(showClient.hasFutureShows).toHaveBeenCalledWith([3]);
    expect(screenRepository.save).not.toHaveBeenCalled();
  });

  it('returns 503 when the Show Service is down', async () => {
    const { service } = buildScreens(outage);
    await expectAppError(service.remove(4, 3), 503);
  });

  it('deactivates a screen with no future shows', async () => {
    const { service, screen } = buildScreens(false);
    await service.remove(4, 3);
    expect(screen.status).toBe(ScreenStatus.INACTIVE);
  });
});

describe('ShowClient.hasFutureShows', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  function client(response: unknown | number) {
    const get = jest.fn(() => {
      if (typeof response === 'number') {
        const error = new AxiosError('failed');
        error.response = { status: response } as AxiosResponse;
        return throwError(() => error);
      }
      return of({ data: response } as AxiosResponse);
    });
    return {
      showClient: new ShowClient({ get } as unknown as HttpService),
      get,
    };
  }

  it('asks for all screens in one call and returns the answer', async () => {
    const { showClient, get } = client({ exists: true });
    await expect(showClient.hasFutureShows([1, 2])).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(
      '/api/internal/shows/exists-future?screenIds=1,2',
    );
  });

  it('returns false for no screens without calling the Show Service', async () => {
    const { showClient, get } = client({ exists: true });
    await expect(showClient.hasFutureShows([])).resolves.toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['a 500', 500],
    ['a missing endpoint (404)', 404],
    ['a malformed answer', { exists: 1 }],
  ])('throws 503 for %s', async (_label, response) => {
    const { showClient } = client(response);
    await expectAppError(showClient.hasFutureShows([1]), 503);
  });
});
