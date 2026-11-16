import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'allowPasswordChangePending';

/**
 * Marks a route a user may call while they still must change a temporary password
 * (change-password, logout, /me). Every other JWT-protected route refuses them.
 */
export const AllowPasswordChangePending = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
