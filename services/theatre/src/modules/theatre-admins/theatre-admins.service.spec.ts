import { Repository } from 'typeorm';
import { AppException } from '@moviebooking/common';
import { TheatreAdmin, TheatreAdminStatus } from '../../entities';
import { IdentityClient } from '../../clients/identity.client';
import { TheatreAdminsService } from './theatre-admins.service';
import { expectAppError } from '../../testing/test-helpers';

type IdentityUser = {
  id: number;
  name: string;
  email: string;
  role: { id: number; code: string; name: string };
};

function build(options: {
  user?: IdentityUser | null | Error;
  activeAssignment?: boolean;
}) {
  const theatreAdminRepository = {
    findOne: jest.fn(async ({ where }: { where: { id?: number } }) => {
      if (where.id) {
        return {
          id: where.id,
          theatreId: 4,
          userId: 9,
          status: TheatreAdminStatus.ACTIVE,
          theatre: { id: 4, name: 'Odeon', city: 'Leeds' },
        };
      }
      return options.activeAssignment ? { id: 1 } : null;
    }),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn(async (data: object) => ({ ...data, id: 50 })),
  };
  const identityClient = {
    getUserById: jest.fn(async () => {
      if (options.user instanceof Error) throw options.user;
      return options.user ?? null;
    }),
  };
  const service = new TheatreAdminsService(
    theatreAdminRepository as unknown as Repository<TheatreAdmin>,
    identityClient as unknown as IdentityClient,
  );
  return { service, theatreAdminRepository };
}

const theatreAdminUser: IdentityUser = {
  id: 9,
  name: 'Taylor',
  email: 'taylor@example.com',
  role: { id: 3, code: 'THEATRE_ADMIN', name: 'Theatre Admin' },
};
// ID encryption is off in tests, so plain digits are valid IDs.
const dto = { userId: '9', theatreId: '4' };

describe('TheatreAdminsService.create (assignment rules)', () => {
  it('assigns a THEATRE_ADMIN user with no active assignment', async () => {
    const { service, theatreAdminRepository } = build({
      user: theatreAdminUser,
    });

    const result = await service.create(dto);

    expect(theatreAdminRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        theatreId: 4,
        status: TheatreAdminStatus.ACTIVE,
      }),
    );
    expect(result.user?.email).toBe('taylor@example.com');
  });

  it('returns 400 for invalid encrypted IDs', async () => {
    const { service } = build({ user: theatreAdminUser });
    await expectAppError(service.create({ userId: 'x', theatreId: '4' }), 400);
  });

  it('returns 404 when the user does not exist', async () => {
    const { service } = build({ user: null });
    await expectAppError(service.create(dto), 404);
  });

  it('returns 422 when the user is not a THEATRE_ADMIN', async () => {
    const { service } = build({
      user: {
        ...theatreAdminUser,
        role: { id: 2, code: 'STAFF', name: 'Staff' },
      },
    });
    await expectAppError(service.create(dto), 422);
  });

  it('returns 409 when the user already has an active assignment', async () => {
    const { service, theatreAdminRepository } = build({
      user: theatreAdminUser,
      activeAssignment: true,
    });
    await expectAppError(service.create(dto), 409);
    expect(theatreAdminRepository.save).not.toHaveBeenCalled();
  });

  it('returns 503 when the Identity Service is down', async () => {
    const { service } = build({
      user: new AppException('SERVICE_UNAVAILABLE'),
    });
    await expectAppError(service.create(dto), 503);
  });
});
