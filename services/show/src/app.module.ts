import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSqlServerOptions } from '@moviebooking/database';
import { DevModule } from '@moviebooking/common';
import { Show, ShowPrice } from './entities';
import { AuthModule } from './modules/auth/auth.module';
import { ShowsModule } from './modules/shows/shows.module';
import { ShowPricesModule } from './modules/show-prices/show-prices.module';
import { InternalModule } from './modules/internal/internal.module';

const devModules = process.env.NODE_ENV !== 'production' ? [DevModule] : [];

/** Root module for Show Service. Configures database, auth, and feature modules. */

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),

    // Database — Show Service owns: shows, show_prices
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createSqlServerOptions((key) => configService.get<string>(key), {
          entities: [Show, ShowPrice],
        }),
    }),

    // Authentication
    AuthModule,

    // Feature modules
    ShowsModule,
    ShowPricesModule,
    InternalModule,

    // Dev modules (only in non-production)
    ...devModules,
  ],
})
export class AppModule {}
