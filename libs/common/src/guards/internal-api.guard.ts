import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { AppException } from '../exceptions/app.exception';

/** Header every service-to-service request must carry. */
export const INTERNAL_API_KEY_HEADER = 'X-Internal-Key';

/** Environment variable holding the shared key. */
export const INTERNAL_API_KEY_ENV = 'INTERNAL_API_KEY';

/**
 * Protects /internal routes: the request must carry an X-Internal-Key header equal to
 * INTERNAL_API_KEY. Missing or wrong key → 401.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env[INTERNAL_API_KEY_ENV];
    const request = context.switchToHttp().getRequest();
    const provided = request.headers[INTERNAL_API_KEY_HEADER.toLowerCase()];

    // Start-up refuses to run without the key; this is a second safeguard.
    if (!expected || typeof provided !== 'string' || provided.length === 0) {
      throw new AppException('UNAUTHORIZED', 'Internal API key required');
    }

    if (!keysMatch(provided, expected)) {
      throw new AppException('UNAUTHORIZED', 'Invalid internal API key');
    }

    return true;
  }
}

/**
 * Constant-time comparison. Both values are hashed first so the buffers always have
 * the same length; timingSafeEqual then compares them without leaking, through
 * response time, how many leading characters were correct.
 */
export function keysMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
