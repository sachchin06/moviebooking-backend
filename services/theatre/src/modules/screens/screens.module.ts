import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScreensController } from './screens.controller';
import { ScreensService } from './screens.service';
import { Screen, Theatre, Seat } from '../../entities';
import { ShowClientModule } from '../../clients/show-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Screen, Theatre, Seat]),
    ShowClientModule,
  ],
  controllers: [ScreensController],
  providers: [ScreensService],
  exports: [ScreensService],
})
export class ScreensModule {}
