import { In, Repository } from 'typeorm';
import { Booking, BookingStatus } from '@moviebooking/database';
import { InternalBookingsService } from './internal-bookings.service';

describe('InternalBookingsService.existsForShow', () => {
  function build(exists: boolean) {
    const repo = { exists: jest.fn().mockResolvedValue(exists) };
    const service = new InternalBookingsService(
      repo as unknown as Repository<Booking>,
    );
    return { service, repo };
  }

  it('counts only bookings that hold or may still hold seats', async () => {
    const { service, repo } = build(true);

    await expect(service.existsForShow(9)).resolves.toEqual({ exists: true });

    expect(repo.exists).toHaveBeenCalledWith({
      where: {
        showId: 9,
        status: In([
          BookingStatus.HOLDING,
          BookingStatus.PAYMENT_PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.PENDING_REVIEW,
        ]),
      },
    });
  });

  it('reports false when the show has no live bookings', async () => {
    const { service } = build(false);
    await expect(service.existsForShow(9)).resolves.toEqual({ exists: false });
  });
});
