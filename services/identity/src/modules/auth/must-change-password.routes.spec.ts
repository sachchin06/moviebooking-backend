import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from '@moviebooking/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';

/**
 * Real JwtStrategy and JwtAuthGuard over HTTP: a token carrying mustChangePassword
 * works only on change-password, logout and /me.
 */
describe('mustChangePassword enforcement (HTTP)', () => {
  const SECRET = 'route-test-secret';
  let app: INestApplication;
  let baseUrl: string;
  const authService = {
    getProfile: jest.fn().mockResolvedValue({ id: 'x' }),
    changePassword: jest.fn().mockResolvedValue({ message: 'ok' }),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  const usersService = { findAll: jest.fn().mockResolvedValue([]) };

  beforeAll(async () => {
    // JwtStrategy reads JWT_SECRET through ConfigService, which falls back to process.env.
    process.env.JWT_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
      ],
      controllers: [AuthController, UsersController],
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => jest.clearAllMocks());

  const token = (mustChangePassword: boolean) =>
    new JwtService({ secret: SECRET }).sign({
      sub: 1,
      id: 1,
      email: 'admin@example.com',
      name: 'Admin',
      role: { id: 1, code: 'SUPER_ADMIN', name: 'Super Admin' },
      ...(mustChangePassword ? { mustChangePassword: true } : {}),
    });

  const call = (method: string, path: string, bearer: string, body?: object) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('allows GET /auth/me, PATCH /auth/password and POST /auth/logout', async () => {
    const pending = token(true);
    expect((await call('GET', '/auth/me', pending)).status).toBe(200);
    expect(
      (
        await call('PATCH', '/auth/password', pending, {
          currentPassword: 'a',
          newPassword: 'b',
        })
      ).status,
    ).not.toBe(403);
    expect((await call('POST', '/auth/logout', pending)).status).toBe(204);
  });

  it('refuses every other protected route with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const res = await call('GET', '/users', token(true));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
    expect(usersService.findAll).not.toHaveBeenCalled();
  });

  it('lets a normal token through', async () => {
    expect((await call('GET', '/users', token(false))).status).toBe(200);
  });
});
