import { AppException, ICurrentUser } from '@moviebooking/common';
import { DataSource } from 'typeorm';

/** DataSource stand-in: transaction() runs the callback and rethrows its errors. */
export function fakeDataSource(manager: unknown): DataSource {
  return {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  } as unknown as DataSource;
}

/** Awaits a promise that must reject with an AppException and returns it. */
export async function expectAppError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
): Promise<AppException> {
  const error = await promise.then(
    () => {
      throw new Error('Expected the call to reject, but it resolved');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(status);
  if (code) {
    expect((error as AppException).errorCode).toBe(code);
  }
  return error as AppException;
}

export function userWithRole(
  code: 'SUPER_ADMIN' | 'STAFF' | 'THEATRE_ADMIN',
  theatreId?: number,
): ICurrentUser {
  return {
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: { id: 1, code, name: code },
    theatreId,
  };
}
