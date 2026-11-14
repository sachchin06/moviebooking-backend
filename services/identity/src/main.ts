import { bootstrapService } from '@moviebooking/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  serviceName: 'Identity Service',
  portEnvKey: 'IDENTITY_SERVICE_PORT',
  defaultPort: 3001,
  implicitConversion: false,
  swagger: {
    title: 'Identity Service API',
    description:
      'Authentication and user management API for Movie Ticket Booking System',
    bearerName: 'JWT-auth',
    tags: [
      ['auth', 'Authentication endpoints'],
      ['users', 'User management endpoints'],
      ['roles', 'Role management endpoints'],
    ],
  },
});
