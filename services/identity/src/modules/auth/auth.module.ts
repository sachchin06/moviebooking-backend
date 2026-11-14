import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TheatreClientModule } from '../../clients/theatre-client.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { parseDurationToSeconds } from './token-lifetime';
import { User, Role } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    TheatreClientModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', ''),
        signOptions: {
          expiresIn: parseDurationToSeconds(
            'JWT_EXPIRES_IN',
            configService.get<string>('JWT_EXPIRES_IN', '1h'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
