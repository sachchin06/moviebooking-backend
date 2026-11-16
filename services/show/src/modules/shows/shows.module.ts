import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Show, ShowPrice } from '../../entities';
import { ShowsController } from './shows.controller';
import { ShowsService } from './shows.service';
import { ShowOwnershipGuard } from './guards/show-ownership.guard';
import { TheatreClientModule } from '../../clients/theatre-client.module';
import { MovieClientModule } from '../../clients/movie-client.module';
import { BookingClientModule } from '../../clients/booking-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Show, ShowPrice]),
    TheatreClientModule,
    MovieClientModule,
    BookingClientModule,
  ],
  controllers: [ShowsController],
  providers: [ShowsService, ShowOwnershipGuard],
  exports: [ShowsService],
})
export class ShowsModule {}
