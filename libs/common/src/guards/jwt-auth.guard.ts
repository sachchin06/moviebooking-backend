import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppException } from '../exceptions/app.exception';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY } from '../decorators/allow-password-change-pending.decorator';
import { ICurrentUser } from '../interfaces/current-user.interface';

/**
 * Requires a valid access token. Also enforces the temporary-password rule: a token
 * carrying mustChangePassword only works on routes marked @AllowPasswordChangePending.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = ICurrentUser>(
    err: unknown,
    user: TUser | false,
    info: { name?: string } | undefined,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new AppException('TOKEN_EXPIRED');
      }
      throw new AppException('UNAUTHORIZED');
    }

    if (
      (user as { mustChangePassword?: boolean }).mustChangePassword &&
      !this.allowsPendingChange(context)
    ) {
      throw new AppException('PASSWORD_CHANGE_REQUIRED');
    }

    return user;
  }

  private allowsPendingChange(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PASSWORD_CHANGE_PENDING_KEY,
        [context.getHandler(), context.getClass()],
      ) === true
    );
  }
}
