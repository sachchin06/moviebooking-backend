import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from '@moviebooking/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';

/**
 * Route-level tests: these start a real HTTP server, because the bug being guarded
 * against (a static route shadowed by a parameterised one) only shows up in routing.
 */
describe('InternalController routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  const internalService = {
    getShowIdsByScreens: jest.fn().mockResolvedValue([101, 102]),
    getShowById: jest.fn().mockResolvedValue({ id: 5 }),
    getPricesByShowId: jest.fn().mockResolvedValue([]),
    hasFutureShows: jest.fn().mockResolvedValue({ exists: false }),
  };

  // Every request carries the internal key; requests without it are tested separately.
  const KEY = 'test-internal-key';
  const get = (path: string) =>
    fetch(`${baseUrl}${path}`, { headers: { 'X-Internal-Key': KEY } });

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = KEY;
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalController],
      providers: [{ provide: InternalService, useValue: internalService }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INTERNAL_API_KEY;
  });

  beforeEach(() => jest.clearAllMocks());

  it('resolves GET /internal/shows/by-screens to the by-screens handler', async () => {
    const res = await get('/internal/shows/by-screens?screenIds=3,1,3');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([101, 102]);
    expect(internalService.getShowIdsByScreens).toHaveBeenCalledWith([3, 1]);
    expect(internalService.getShowById).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', ''],
    ['empty', '?screenIds='],
    ['non-numeric', '?screenIds=1,abc'],
    ['zero', '?screenIds=0'],
    ['negative', '?screenIds=-4'],
    ['decimal', '?screenIds=1.5'],
  ])('returns 400 for %s screenIds', async (_label, query) => {
    const res = await get(`/internal/shows/by-screens${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(internalService.getShowIdsByScreens).not.toHaveBeenCalled();
  });

  it('still resolves GET /internal/shows/:id', async () => {
    const res = await get('/internal/shows/5');

    expect(res.status).toBe(200);
    expect(internalService.getShowById).toHaveBeenCalledWith(5);
  });

  it.each([
    ['no key', {}],
    ['a wrong key', { 'X-Internal-Key': 'wrong' }],
  ])(
    'returns 401 with %s and never calls the service',
    async (_label, headers) => {
      for (const path of [
        '/internal/shows/5',
        '/internal/shows/by-screens?screenIds=1',
      ]) {
        const res = await fetch(`${baseUrl}${path}`, { headers });
        expect(res.status).toBe(401);
      }
      expect(internalService.getShowById).not.toHaveBeenCalled();
      expect(internalService.getShowIdsByScreens).not.toHaveBeenCalled();
    },
  );

  describe('GET /internal/shows/exists-future', () => {
    it('resolves to its own handler, not to shows/:id', async () => {
      const res = await get('/internal/shows/exists-future?screenIds=4,2,4');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ exists: false });
      expect(internalService.hasFutureShows).toHaveBeenCalledWith([4, 2]);
      expect(internalService.getShowById).not.toHaveBeenCalled();
    });

    it.each(['', '?screenIds=', '?screenIds=0', '?screenIds=a'])(
      'returns 400 for screenIds "%s"',
      async (query) => {
        const res = await get(`/internal/shows/exists-future${query}`);
        expect(res.status).toBe(400);
        expect(internalService.hasFutureShows).not.toHaveBeenCalled();
      },
    );

    it('returns 401 without the internal key', async () => {
      const res = await fetch(
        `${baseUrl}/internal/shows/exists-future?screenIds=1`,
      );
      expect(res.status).toBe(401);
    });
  });
});
