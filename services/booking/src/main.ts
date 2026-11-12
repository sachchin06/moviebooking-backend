import { bootstrapService } from '@moviebooking/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  serviceName: 'Booking Service',
  portEnvKey: 'BOOKING_SERVICE_PORT',
  defaultPort: 3005,
  implicitConversion: true,
  swagger: {
    title: 'Booking Service API',
    description: 'Seat holds, bookings, and booking state management',
  },
});
