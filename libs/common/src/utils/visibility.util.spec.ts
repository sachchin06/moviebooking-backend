import { ICurrentUser } from '../interfaces/current-user.interface';
import { canSeeInactiveEverywhere } from './visibility.util';

const withRole = (code: string): ICurrentUser => ({
  id: 1,
  email: 'a@b.c',
  name: 'A',
  role: { id: 1, code, name: code },
});

describe('canSeeInactiveEverywhere', () => {
  it.each(['SUPER_ADMIN', 'STAFF'])('is true for %s', (role) => {
    expect(canSeeInactiveEverywhere(withRole(role))).toBe(true);
  });

  it.each(['THEATRE_ADMIN', 'SOMETHING_ELSE'])('is false for %s', (role) => {
    expect(canSeeInactiveEverywhere(withRole(role))).toBe(false);
  });

  it('is false for guests', () => {
    expect(canSeeInactiveEverywhere(undefined)).toBe(false);
    expect(canSeeInactiveEverywhere(null)).toBe(false);
  });
});
