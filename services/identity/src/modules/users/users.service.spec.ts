import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role, User, UserStatus } from '../../entities';
import { UsersService } from './users.service';
import { expectAppError } from '../../testing/test-helpers';

function build(options: { emailTaken?: boolean; roleExists?: boolean } = {}) {
  let saved: User | undefined;
  const userRepository = {
    findOne: jest.fn(
      async ({ where }: { where: { email?: string; id?: number } }) => {
        if (where.email) return options.emailTaken ? ({ id: 1 } as User) : null;
        return saved
          ? ({
              ...saved,
              role: { id: 2, code: 'STAFF', name: 'Staff' },
            } as User)
          : null;
      },
    ),
    create: jest.fn((data: Partial<User>) => ({ ...data }) as User),
    save: jest.fn(async (user: User) => {
      saved = { ...user, id: 9 } as User;
      return saved;
    }),
  };
  const roleRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.roleExists === false
          ? null
          : { id: 2, code: 'STAFF', name: 'Staff' },
      ),
  };
  const service = new UsersService(
    userRepository as unknown as Repository<User>,
    roleRepository as unknown as Repository<Role>,
  );
  return { service, saved: () => saved };
}

const dto = { name: 'Sam', email: 'sam@example.com', roleId: 2 };

describe('UsersService.create', () => {
  it('creates the user with a temporary password that expires in 24 hours and must be changed', async () => {
    const { service, saved } = build();
    const before = Date.now();

    const result = await service.create(dto);

    const user = saved()!;
    expect(user.mustChangePassword).toBe(true);
    expect(user.status).toBe(UserStatus.ACTIVE);
    const expiresIn = user.passwordExpiresAt!.getTime() - before;
    expect(expiresIn).toBeGreaterThan(24 * 3600_000 - 5_000);
    expect(expiresIn).toBeLessThanOrEqual(24 * 3600_000 + 5_000);

    // The returned temporary password is the one that was hashed and stored.
    expect(result.tempPassword).toMatch(/^Temp@/);
    expect(await bcrypt.compare(result.tempPassword, user.passwordHash)).toBe(
      true,
    );
  });

  it('returns 409 for an email that is already in use', async () => {
    await expectAppError(build({ emailTaken: true }).service.create(dto), 409);
  });

  it('returns 404 for an unknown role', async () => {
    await expectAppError(build({ roleExists: false }).service.create(dto), 404);
  });
});
