import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpExceptionFilter } from '@moviebooking/common';
import { Booking, BookingStatus } from '@moviebooking/database';
import { BookingsController } from './bookings.controller';
import { BookingCancelService } from './booking-cancel.service';
import { BookingQueryService } from './booking-query.service';
import { HoldService } from './hold.service';
import { BookingEventsPublisher } from '../../messaging/booking-events.publisher';
import { fakeDataSource } from '../../testing/test-helpers';

/**
 * POST /bookings/:bookingRef/cancel over HTTP, with the real BookingCancelService
 * and only the database faked, so the cancel rules are checked end to end.
 */
describe('POST /bookings/:bookingRef/cancel (real cancel service)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let stored: Record<string, unknown> | null;

  const manager = {
    findOne: jest.fn(async () => stored),
    save: jest.fn(async (_entity: unknown, value: unknown) => value),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const bookingRepo = {
    findOne: jest.fn(async () => ({
      ...stored,
      seats: [
        { seatId: 10, seatCode: 'A1', seatType: 'STANDARD', priceCents: 1000 },
      ],
      holds: [],
    })),
  };
  const publisher = { publishFailed: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        BookingCancelService,
        { provide: DataSource, useValue: fakeDataSource(manager) },
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: BookingEventsPublisher, useValue: publisher },
        { provide: HoldService, useValue: {} },
        { provide: BookingQueryService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    stored = {
      id: 3,
      bookingRef: 'REF0000003',
      showId: 9,
      email: 'guest@example.com',
      status: BookingStatus.HOLDING,
      totalAmountCents: 1000,
      currency: 'GBP',
      holdExpiresAt: new Date(Date.now() + 60_000),
      paymentExpiresAt: null,
    };
  });

  const cancel = (email: string) =>
    fetch(`${baseUrl}/bookings/REF0000003/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });

  it('cancels a HOLDING booking: 200, status FAILED, event published', async () => {
    const res = await cancel('guest@example.com');

    expect(res.status).toBe(200);
    // No TransformInterceptor in this test app, so the body is not wrapped in { data }.
    const body = (await res.json()) as {
      status: string;
      seats: { seatCode: string }[];
    };
    expect(body.status).toBe(BookingStatus.FAILED);
    expect(body.seats[0].seatCode).toBe('A1');
    expect(publisher.publishFailed).toHaveBeenCalledWith({
      bookingRef: 'REF0000003',
      showId: 9,
    });
  });

  it('returns 404 when the email does not match', async () => {
    expect((await cancel('someone@else.com')).status).toBe(404);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns 422 once payment has started', async () => {
    stored = { ...stored, status: BookingStatus.PAYMENT_PENDING };
    expect((await cancel('guest@example.com')).status).toBe(422);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown reference', async () => {
    stored = null;
    expect((await cancel('guest@example.com')).status).toBe(404);
  });
});
