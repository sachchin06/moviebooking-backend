import { ExecutionContext } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { InternalApiGuard, keysMatch } from './internal-api.guard';

const KEY = 'a-long-shared-internal-key';

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function statusOf(run: () => unknown): number | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return (error as AppException).getStatus();
  }
}

describe('InternalApiGuard', () => {
  const guard = new InternalApiGuard();

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
  });

  afterAll(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  it('allows a request carrying the correct key', () => {
    // Node lower-cases incoming header names.
    const ctx = contextWithHeaders({ 'x-internal-key': KEY });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns 401 when the header is missing', () => {
    expect(statusOf(() => guard.canActivate(contextWithHeaders({})))).toBe(401);
  });

  it('returns 401 when the header is empty', () => {
    const ctx = contextWithHeaders({ 'x-internal-key': '' });
    expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
  });

  it.each([
    ['a wrong key of the same length', KEY.replace(/.$/, 'X')],
    ['a shorter key', KEY.slice(0, 5)],
    ['a longer key', `${KEY}-extra`],
  ])('returns 401 for %s', (_label, provided) => {
    const ctx = contextWithHeaders({ 'x-internal-key': provided });
    expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
  });

  it('returns 401 for every request when INTERNAL_API_KEY is not configured', () => {
    delete process.env.INTERNAL_API_KEY;
    const ctx = contextWithHeaders({ 'x-internal-key': 'anything' });
    expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
  });
});

describe('keysMatch', () => {
  it('is true only for identical keys', () => {
    expect(keysMatch(KEY, KEY)).toBe(true);
    expect(keysMatch(KEY.toUpperCase(), KEY)).toBe(false);
  });

  it('compares keys of different lengths without throwing', () => {
    // crypto.timingSafeEqual throws on unequal lengths; hashing first avoids that.
    expect(() => keysMatch('short', KEY)).not.toThrow();
    expect(keysMatch('short', KEY)).toBe(false);
  });
});
