import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AppException, BaseServiceClient } from '@moviebooking/common';

/** Client for the Booking Service internal APIs. */
@Injectable()
export class BookingClient extends BaseServiceClient {
  constructor(httpService: HttpService) {
    super(httpService, 'BookingClient');
  }

  /**
   * True when the show has bookings in HOLDING, PAYMENT_PENDING, CONFIRMED or
   * PENDING_REVIEW. Throws SERVICE_UNAVAILABLE when the Booking Service cannot give a
   * clear answer, so callers never treat "unknown" as "no bookings".
   */
  async hasLiveBookings(showId: number): Promise<boolean> {
    const result = await this.get<{ exists: boolean }>(
      `/api/internal/bookings/exists?showId=${showId}`,
    );
    // A 404 here means the endpoint is missing, not "no bookings".
    if (result === null || typeof result.exists !== 'boolean') {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Could not confirm whether the show has bookings',
      );
    }
    return result.exists;
  }
}
