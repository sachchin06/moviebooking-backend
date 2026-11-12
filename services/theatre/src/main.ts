import { bootstrapService } from '@moviebooking/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  serviceName: 'Theatre Service',
  portEnvKey: 'THEATRE_SERVICE_PORT',
  defaultPort: 3002,
  implicitConversion: false,
  swagger: {
    title: 'Theatre Service API',
    description:
      'Theatre, screen, and seat management API for Movie Ticket Booking System',
    bearerName: 'JWT-auth',
    tags: [
      ['theatres', 'Theatre management endpoints'],
      ['screens', 'Screen management endpoints'],
      ['seats', 'Seat management endpoints'],
      ['theatre-admins', 'Theatre admin assignment endpoints'],
    ],
  },
});
