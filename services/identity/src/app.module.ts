import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSqlServerOptions } from '@moviebooking/database';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { InternalModule } from './modules/internal/internal.module';
import { DevModule } from '@moviebooking/common';
import { User, Role } from './entities';

// Conditionally include DevModule only in development
const devModules = process.env.NODE_ENV !== 'production' ? [DevModule] : [];

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createSqlServerOptions((key) => configService.get<string>(key), {
          entities: [User, Role],
        }),
    }),

    // Feature modules
    AuthModule,
    UsersModule,
    InternalModule,

    // Dev modules (only in non-production)
    ...devModules,
  ],
})
export class AppModule {}
