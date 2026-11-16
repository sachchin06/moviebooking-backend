import { ROLES } from '../constants/roles.constant';
import { ICurrentUser } from '../interfaces/current-user.interface';

/**
 * Business rule 4: only SUPER_ADMIN and STAFF see INACTIVE movies and shows across
 * all theatres. Everyone else sees ACTIVE records only (a THEATRE_ADMIN additionally
 * sees INACTIVE shows of their own theatre, which the Show Service handles).
 */
export function canSeeInactiveEverywhere(user?: ICurrentUser | null): boolean {
  const role = user?.role?.code;
  return role === ROLES.SUPER_ADMIN || role === ROLES.STAFF;
}
