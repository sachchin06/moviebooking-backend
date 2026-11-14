import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../exceptions/app.exception';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const context = {
  getHandler: () => () => undefined,
  getClass: () => class {},
} as unknown as ExecutionContext;

function guardWith(routeAllowsPendingChange: boolean) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(routeAllowsPendingChange),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

function errorFrom(run: () => unknown): AppException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }
  throw new Error('Expected an AppException');
}

const user = {
  id: 1,
  email: 'a@b.c',
  name: 'A',
  role: { id: 1, code: 'STAFF', name: 'Staff' },
};

describe('JwtAuthGuard', () => {
  it('passes a normal user through', () => {
    expect(guardWith(false).handleRequest(null, user, undefined, context)).toBe(
      user,
    );
  });

  it('returns 401 without a user and TOKEN_EXPIRED for an expired token', () => {
    const missing = errorFrom(() =>
      guardWith(false).handleRequest(null, false, undefined, context),
    );
    expect(missing.getStatus()).toBe(401);

    const expired = errorFrom(() =>
      guardWith(false).handleRequest(
        null,
        false,
        { name: 'TokenExpiredError' },
        context,
      ),
    );
    expect(expired.errorCode).toBe('TOKEN_EXPIRED');
  });

  describe('mustChangePassword', () => {
    const pending = { ...user, mustChangePassword: true };

    it('refuses other routes with 403 PASSWORD_CHANGE_REQUIRED', () => {
      const error = errorFrom(() =>
        guardWith(false).handleRequest(null, pending, undefined, context),
      );
      expect(error.getStatus()).toBe(403);
      expect(error.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('allows routes marked @AllowPasswordChangePending', () => {
      expect(
        guardWith(true).handleRequest(null, pending, undefined, context),
      ).toBe(pending);
    });
  });
});

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('treats a user who must change their password as a guest', () => {
    expect(
      guard.handleRequest(null, { ...user, mustChangePassword: true }),
    ).toBeNull();
  });

  it('keeps a normal user and maps no user to null', () => {
    expect(guard.handleRequest(null, user)).toBe(user);
    expect(guard.handleRequest(null, false)).toBeNull();
  });
});
