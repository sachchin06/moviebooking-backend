import { bootstrapService } from '@moviebooking/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  serviceName: 'Movie Service',
  portEnvKey: 'MOVIE_SERVICE_PORT',
  defaultPort: 3003,
  implicitConversion: false,
  swagger: {
    title: 'Movie Service API',
    description:
      'Movie catalogue and request management API for Movie Ticket Booking System',
    bearerName: 'JWT-auth',
    tags: [
      ['movies', 'Movie catalogue endpoints'],
      ['movie-images', 'Movie image management endpoints'],
      ['movie-requests', 'Movie request workflow endpoints'],
    ],
  },
});
