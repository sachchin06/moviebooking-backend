import { Module } from '@nestjs/common';
import { ServiceClientModule } from '@moviebooking/common';
import { ShowClient } from './show.client';

const showClientModule = ServiceClientModule.register({
  envKey: 'SHOW_SERVICE_URL',
  defaultUrl: 'http://localhost:3004',
  client: ShowClient,
});

/** HTTP client for the Show Service (SHOW_SERVICE_URL). */
@Module({
  imports: [showClientModule],
  exports: [showClientModule],
})
export class ShowClientModule {}
