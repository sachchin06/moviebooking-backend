import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from '@moviebooking/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';

/** Theatre /internal routes: shared-key protection and validated batch bodies. */
describe('Theatre /internal routes', () => {
  const KEY = 'theatre-test-internal-key';
  let app: INestApplication;
  let baseUrl: string;
  const internalService = {
    getScreenById: jest.fn().mockResolvedValue({ id: 3, theatreId: 1 }),
    getScreensByIds: jest.fn().mockResolvedValue([{ id: 3, theatreId: 1 }]),
    getSeatsByScreenId: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = KEY;
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalController],
      providers: [{ provide: InternalService, useValue: internalService }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Same validation settings as bootstrapService uses for this service.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INTERNAL_API_KEY;
  });

  beforeEach(() => jest.clearAllMocks());

  const postBatch = (body: unknown, key?: string) =>
    fetch(`${baseUrl}/internal/screens/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'X-Internal-Key': key } : {}),
      },
      body: JSON.stringify(body),
    });

  it.each([
    ['GET /internal/screens/3', () => fetch(`${baseUrl}/internal/screens/3`)],
    [
      'GET /internal/screens/3/seats',
      () => fetch(`${baseUrl}/internal/screens/3/seats`),
    ],
    ['POST /internal/screens/batch', () => postBatch({ screenIds: [3] })],
  ])('%s returns 401 without the key', async (_label, request) => {
    expect((await request()).status).toBe(401);
    expect(internalService.getScreenById).not.toHaveBeenCalled();
    expect(internalService.getScreensByIds).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong key', async () => {
    expect((await postBatch({ screenIds: [3] }, 'nope')).status).toBe(401);
  });

  it('returns 400 for an invalid batch body, even with the key', async () => {
    const res = await postBatch({ screenIds: ['3', -1] }, KEY);
    expect(res.status).toBe(400);
    expect(internalService.getScreensByIds).not.toHaveBeenCalled();
  });

  it('serves the batch lookup with the key and a valid body', async () => {
    const res = await postBatch({ screenIds: [3] }, KEY);
    expect(res.status).toBe(201);
    expect(internalService.getScreensByIds).toHaveBeenCalledWith([3]);
  });
});
