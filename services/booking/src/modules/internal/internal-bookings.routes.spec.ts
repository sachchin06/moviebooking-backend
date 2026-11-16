import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from '@moviebooking/common';
import { InternalBookingsController } from './internal-bookings.controller';
import { InternalBookingsService } from './internal-bookings.service';
import { InternalTransitionsService } from './internal-transitions.service';

/** /internal routes must refuse any request without the shared internal key. */
describe('Booking /internal routes need X-Internal-Key', () => {
  const KEY = 'booking-test-internal-key';
  let app: INestApplication;
  let baseUrl: string;
  const internalBookingsService = {
    getByReference: jest.fn().mockResolvedValue({ bookingRef: 'REF0000001' }),
    existsForShow: jest.fn().mockResolvedValue({ exists: true }),
  };
  const internalTransitionsService = {
    markPaymentPending: jest
      .fn()
      .mockResolvedValue({ status: 'PAYMENT_PENDING' }),
    confirmBooking: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    failBooking: jest.fn().mockResolvedValue({ status: 'FAILED' }),
  };

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = KEY;
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalBookingsController],
      providers: [
        { provide: InternalBookingsService, useValue: internalBookingsService },
        {
          provide: InternalTransitionsService,
          useValue: internalTransitionsService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Same validation settings as bootstrapService uses for booking.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
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

  const call = (method: string, path: string, key?: string) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: key ? { 'X-Internal-Key': key } : {},
    });

  const routes: [string, string][] = [
    ['GET', '/internal/bookings/REF0000001'],
    ['GET', '/internal/bookings/exists?showId=5'],
    ['POST', '/internal/bookings/REF0000001/mark-payment-pending'],
    ['POST', '/internal/bookings/REF0000001/confirm'],
    ['POST', '/internal/bookings/REF0000001/fail'],
  ];

  it.each(routes)('%s %s returns 401 without the key', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'UNAUTHORIZED',
    );
  });

  it.each(routes)(
    '%s %s returns 401 with a wrong key',
    async (method, path) => {
      expect((await call(method, path, 'wrong-key')).status).toBe(401);
    },
  );

  it('never reaches the services without a valid key', async () => {
    for (const [method, path] of routes) {
      await call(method, path, 'wrong-key');
    }
    expect(internalBookingsService.getByReference).not.toHaveBeenCalled();
    expect(internalTransitionsService.confirmBooking).not.toHaveBeenCalled();
  });

  it('confirm works with the correct key', async () => {
    const res = await call(
      'POST',
      '/internal/bookings/REF0000001/confirm',
      KEY,
    );
    expect(res.status).toBe(201);
    expect(internalTransitionsService.confirmBooking).toHaveBeenCalledWith(
      'REF0000001',
    );
  });

  describe('GET /internal/bookings/exists', () => {
    it('resolves to the exists handler, not to :bookingRef', async () => {
      const res = await call('GET', '/internal/bookings/exists?showId=5', KEY);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ exists: true });
      expect(internalBookingsService.existsForShow).toHaveBeenCalledWith(5);
      expect(internalBookingsService.getByReference).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', ''],
      ['zero', '?showId=0'],
      ['negative', '?showId=-3'],
      ['non-numeric', '?showId=abc'],
      ['an unknown parameter', '?showId=5&extra=1'],
    ])('returns 400 for a %s showId', async (_label, query) => {
      const res = await call('GET', `/internal/bookings/exists${query}`, KEY);
      expect(res.status).toBe(400);
      expect(internalBookingsService.existsForShow).not.toHaveBeenCalled();
    });
  });
});
