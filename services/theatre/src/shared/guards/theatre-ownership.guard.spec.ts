import { ExecutionContext } from '@nestjs/common';
import { AppException, ICurrentUser } from '@moviebooking/common';
import { TheatreOwnershipGuard } from './theatre-ownership.guard';
import { userWithRole } from '../../testing/test-helpers';

function contextFor(user: ICurrentUser, params: Record<string, string> = {}) {
  const request: Record<string, unknown> = { user, params };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function statusOf(run: () => boolean): number | boolean {
  try {
    return run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return (error as AppException).getStatus();
  }
}

// ID encryption is off in tests, so the URL's theatreId is plain digits.
describe('TheatreOwnershipGuard', () => {
  const guard = new TheatreOwnershipGuard();

  it('lets a super admin through for any theatre', () => {
    const { context } = contextFor(userWithRole('SUPER_ADMIN'), {
      theatreId: '99',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a theatre admin on their own theatre and records it on the request', () => {
    const { context, request } = contextFor(userWithRole('THEATRE_ADMIN', 7), {
      theatreId: '7',
    });
    expect(guard.canActivate(context)).toBe(true);
    expect(request.theatreId).toBe(7);
  });

  it('returns 403 for a different theatre', () => {
    const { context } = contextFor(userWithRole('THEATRE_ADMIN', 7), {
      theatreId: '8',
    });
    expect(statusOf(() => guard.canActivate(context))).toBe(403);
  });

  it('returns 403 for an invalid theatre ID in the URL', () => {
    const { context } = contextFor(userWithRole('THEATRE_ADMIN', 7), {
      theatreId: 'not-an-id',
    });
    expect(statusOf(() => guard.canActivate(context))).toBe(403);
  });

  it('returns 403 when the token has no theatre claim', () => {
    const { context } = contextFor(userWithRole('THEATRE_ADMIN'), {
      theatreId: '7',
    });
    expect(statusOf(() => guard.canActivate(context))).toBe(403);
  });
});
