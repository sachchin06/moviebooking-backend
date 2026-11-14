import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AppException } from '@moviebooking/common';
import { User, UserStatus } from '../../entities';
import { TheatreClient } from '../../clients/theatre.client';
import { AuthService } from './auth.service';
import { expectAppError } from '../../testing/test-helpers';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';
const PASSWORD = 'Correct-Horse-1';
// Low cost factor keeps the tests fast; bcrypt.compare works for any cost.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 5,
    name: 'Alex',
    email: 'alex@example.com',
    passwordHash: PASSWORD_HASH,
    roleId: 2,
    role: { id: 2, code: 'STAFF', name: 'Staff' },
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    passwordExpiresAt: null,
    ...overrides,
  } as User;
}

function build(options: {
  user?: User | null;
  config?: Record<string, string>;
  theatreId?: number | null | Error;
}) {
  const config: Record<string, string> = {
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    ...options.config,
  };
  const configService = {
    get: (key: string, fallback?: string) => config[key] ?? fallback,
  } as unknown as ConfigService;
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(options.user ?? null),
  };
  const theatreClient = {
    getTheatreIdByUserId: jest.fn(async () => {
      if (options.theatreId instanceof Error) throw options.theatreId;
      return options.theatreId ?? null;
    }),
  };
  const jwtService = new JwtService({ secret: ACCESS_SECRET });
  const service = new AuthService(
    userRepository as unknown as Repository<User>,
    theatreClient as unknown as TheatreClient,
    jwtService,
    configService,
  );
  return { service, jwtService, theatreClient, userRepository };
}

const login = (email = 'alex@example.com', password = PASSWORD) => ({
  email,
  password,
});

describe('AuthService.login', () => {
  it('issues tokens for a correct password', async () => {
    const { service, jwtService } = build({ user: makeUser() });

    const result = await service.login(login());

    const claims = jwtService.verify(result.accessToken);
    expect(claims).toMatchObject({ sub: 5, email: 'alex@example.com' });
    expect(claims.theatreId).toBeUndefined();
    expect(claims.mustChangePassword).toBeUndefined();
  });

  it.each([
    ['an unknown email', null, PASSWORD],
    ['a wrong password', makeUser(), 'wrong-password'],
    [
      'a disabled account (correct password)',
      makeUser({ status: UserStatus.DISABLED }),
      PASSWORD,
    ],
    [
      'a disabled account (wrong password)',
      makeUser({ status: UserStatus.DISABLED }),
      'wrong-password',
    ],
  ])('returns the same generic 401 for %s', async (_label, user, password) => {
    const { service } = build({ user });

    const error = await expectAppError(
      service.login(login(undefined, password)),
      401,
      'INVALID_CREDENTIALS',
    );
    expect(error.message).toBe('Invalid email or password');
  });

  it('returns PASSWORD_EXPIRED for a correct but expired temporary password', async () => {
    const { service } = build({
      user: makeUser({
        mustChangePassword: true,
        passwordExpiresAt: new Date(Date.now() - 60_000),
      }),
    });
    await expectAppError(service.login(login()), 401, 'PASSWORD_EXPIRED');
  });

  it('puts the theatre admin’s theatreId in the access token', async () => {
    const { service, jwtService, theatreClient } = build({
      user: makeUser({
        role: { id: 3, code: 'THEATRE_ADMIN', name: 'TA' } as User['role'],
      }),
      theatreId: 42,
    });

    const result = await service.login(login());

    expect(theatreClient.getTheatreIdByUserId).toHaveBeenCalledWith(5);
    expect(jwtService.verify(result.accessToken).theatreId).toBe(42);
    expect(result.user.assignedTheatreId).toBeTruthy();
  });

  it('marks the token and response when the password must be changed', async () => {
    const { service, jwtService } = build({
      user: makeUser({
        mustChangePassword: true,
        passwordExpiresAt: new Date(Date.now() + 60_000),
      }),
    });

    const result = await service.login(login());

    expect(result.mustChangePassword).toBe(true);
    expect(jwtService.verify(result.accessToken).mustChangePassword).toBe(true);
  });

  it('reports expiresIn from JWT_EXPIRES_IN and signs the token to match', async () => {
    const { service, jwtService } = build({
      user: makeUser(),
      config: { JWT_EXPIRES_IN: '15m' },
    });

    const result = await service.login(login());

    expect(result.expiresIn).toBe(900);
    const { iat, exp } = jwtService.verify(result.accessToken);
    expect(exp - iat).toBe(900);
  });
});

describe('AuthService.refreshToken', () => {
  function refreshTokenFor(userId: number, expiresIn: number | string = '7d') {
    return new JwtService().sign(
      { sub: userId },
      { secret: REFRESH_SECRET, expiresIn },
    );
  }

  it('issues a new access token for a valid refresh token', async () => {
    const { service, jwtService } = build({ user: makeUser() });
    const result = await service.refreshToken(refreshTokenFor(5));
    expect(jwtService.verify(result.accessToken).sub).toBe(5);
  });

  it.each([
    [
      'a token signed with another secret',
      () => new JwtService().sign({ sub: 5 }, { secret: 'other' }),
    ],
    ['garbage', () => 'not-a-jwt'],
    [
      'an access token used as a refresh token',
      () => new JwtService().sign({ sub: 5 }, { secret: ACCESS_SECRET }),
    ],
  ])('returns 401 TOKEN_INVALID for %s', async (_label, token) => {
    const { service } = build({ user: makeUser() });
    await expectAppError(service.refreshToken(token()), 401, 'TOKEN_INVALID');
  });

  it('returns 401 TOKEN_INVALID for an expired refresh token', async () => {
    const { service } = build({ user: makeUser() });
    const expired = new JwtService().sign(
      { sub: 5, exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: REFRESH_SECRET },
    );
    await expectAppError(service.refreshToken(expired), 401, 'TOKEN_INVALID');
  });

  it('returns 401 TOKEN_INVALID for a disabled or deleted user', async () => {
    await expectAppError(
      build({
        user: makeUser({ status: UserStatus.DISABLED }),
      }).service.refreshToken(refreshTokenFor(5)),
      401,
      'TOKEN_INVALID',
    );
    await expectAppError(
      build({ user: null }).service.refreshToken(refreshTokenFor(5)),
      401,
      'TOKEN_INVALID',
    );
  });

  it('returns 503 (not TOKEN_INVALID) when the Theatre Service is down', async () => {
    const { service } = build({
      user: makeUser({
        role: { id: 3, code: 'THEATRE_ADMIN', name: 'TA' } as User['role'],
      }),
      theatreId: new AppException('SERVICE_UNAVAILABLE'),
    });
    await expectAppError(service.refreshToken(refreshTokenFor(5)), 503);
  });

  it('drops mustChangePassword once the password has been changed', async () => {
    const { service, jwtService } = build({
      user: makeUser({ mustChangePassword: false }),
    });
    const result = await service.refreshToken(refreshTokenFor(5));
    expect(
      jwtService.verify(result.accessToken).mustChangePassword,
    ).toBeUndefined();
  });
});
