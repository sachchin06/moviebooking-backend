import { ExecutionContext } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AppException, ICurrentUser } from '@moviebooking/common';
import { Show } from '../../../entities';
import { TheatreClient } from '../../../clients/theatre.client';
import { ShowOwnershipGuard } from './show-ownership.guard';
import { userWithRole } from '../../../testing/test-helpers';

// Screens 1 and 2 belong to theatre 7; screen 3 to theatre 8. Show 20 is on screen 1,
// show 30 on screen 3. Encryption is off in tests, so IDs are plain digits.
const screenTheatre: Record<number, number> = { 1: 7, 2: 7, 3: 8 };
const showScreen: Record<number, number> = { 20: 1, 30: 3 };

function build() {
  const showRepository = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      showScreen[where.id]
        ? { id: where.id, screenId: showScreen[where.id] }
        : null,
    ),
  };
  const theatreClient = {
    getScreen: jest.fn(async (id: number) =>
      screenTheatre[id] ? { id, theatreId: screenTheatre[id] } : null,
    ),
  };
  const guard = new ShowOwnershipGuard(
    showRepository as unknown as Repository<Show>,
    theatreClient as unknown as TheatreClient,
  );
  return { guard, showRepository, theatreClient };
}

function request(
  user: ICurrentUser,
  method: string,
  options: { body?: object; params?: object } = {},
): ExecutionContext {
  const req = {
    user,
    method,
    body: options.body ?? {},
    params: options.params ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function statusOf(promise: Promise<boolean>): Promise<number | boolean> {
  try {
    return await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return (error as AppException).getStatus();
  }
}

describe('ShowOwnershipGuard', () => {
  const admin7 = userWithRole('THEATRE_ADMIN', 7);

  it.each(['SUPER_ADMIN', 'STAFF'] as const)(
    'lets %s through without lookups',
    async (role) => {
      const { guard, theatreClient } = build();
      await expect(
        guard.canActivate(
          request(userWithRole(role), 'PATCH', { params: { id: '30' } }),
        ),
      ).resolves.toBe(true);
      expect(theatreClient.getScreen).not.toHaveBeenCalled();
    },
  );

  it('returns 403 for a theatre admin with no theatre assignment', async () => {
    const { guard } = build();
    const ctx = request(userWithRole('THEATRE_ADMIN'), 'POST', {
      body: { screenId: '1' },
    });
    expect(await statusOf(guard.canActivate(ctx))).toBe(403);
  });

  describe('POST (screenId in the body)', () => {
    it('allows a screen in the admin’s own theatre', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(
            request(admin7, 'POST', { body: { screenId: '2' } }),
          ),
        ),
      ).toBe(true);
    });

    it('returns 403 for a screen in another theatre', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(
            request(admin7, 'POST', { body: { screenId: '3' } }),
          ),
        ),
      ).toBe(403);
    });

    it('returns 404 for an unknown screen and 400 for an invalid screenId', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(
            request(admin7, 'POST', { body: { screenId: '99' } }),
          ),
        ),
      ).toBe(404);
      expect(
        await statusOf(
          guard.canActivate(
            request(admin7, 'POST', { body: { screenId: 'x' } }),
          ),
        ),
      ).toBe(400);
    });
  });

  describe.each(['PATCH', 'DELETE'])('%s (show ID in the URL)', (method) => {
    it('allows a show on the admin’s own theatre', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(request(admin7, method, { params: { id: '20' } })),
        ),
      ).toBe(true);
    });

    it('returns 403 for a show in another theatre', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(request(admin7, method, { params: { id: '30' } })),
        ),
      ).toBe(403);
    });

    it('returns 404 for an unknown show', async () => {
      const { guard } = build();
      expect(
        await statusOf(
          guard.canActivate(request(admin7, method, { params: { id: '77' } })),
        ),
      ).toBe(404);
    });
  });

  it('checks the show for PUT /shows/:showId/prices', async () => {
    const { guard } = build();
    expect(
      await statusOf(
        guard.canActivate(request(admin7, 'PUT', { params: { showId: '30' } })),
      ),
    ).toBe(403);
  });
});
