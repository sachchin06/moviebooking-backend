import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSqlServerOptions } from '@moviebooking/database';
import { DevModule } from '@moviebooking/common';
import { Theatre, TheatreAdmin, Screen, Seat } from './entities';
import { InternalModule } from './modules/internal/internal.module';
import { AuthModule } from './modules/auth/auth.module';
import { TheatresModule } from './modules/theatres/theatres.module';
import { TheatreAdminsModule } from './modules/theatre-admins/theatre-admins.module';
import { ScreensModule } from './modules/screens/screens.module';
import { SeatsModule } from './modules/seats/seats.module';

// Conditionally include DevModule only in development
const devModules = process.env.NODE_ENV !== 'production' ? [DevModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),

    // Database — Theatre Service owns: theatres, theatre_admins, screens, seats
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createSqlServerOptions((key) => configService.get<string>(key), {
          entities: [Theatre, TheatreAdmin, Screen, Seat],
        }),
    }),

    // Feature modules
    AuthModule,
    InternalModule,
    TheatresModule,
    TheatreAdminsModule,
    ScreensModule,
    SeatsModule,

    // Dev modules (only in non-production)
    ...devModules,
  ],
})
export class AppModule {}
