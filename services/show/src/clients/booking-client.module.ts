import { Module } from '@nestjs/common';
import { ServiceClientModule } from '@moviebooking/common';
import { BookingClient } from './booking.client';

const bookingClientModule = ServiceClientModule.register({
  envKey: 'BOOKING_SERVICE_URL',
  defaultUrl: 'http://localhost:3005',
  client: BookingClient,
});

/** HTTP client for the Booking Service (BOOKING_SERVICE_URL). */
@Module({
  imports: [bookingClientModule],
  exports: [bookingClientModule],
})
export class BookingClientModule {}
