import { bootstrapService } from '@moviebooking/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, {
  serviceName: 'Show Service',
  portEnvKey: 'SHOW_SERVICE_PORT',
  defaultPort: 3004,
  implicitConversion: true,
  swagger: {
    title: 'Show Service API',
    description: 'Show scheduling and pricing management',
  },
});
