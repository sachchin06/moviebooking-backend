import { throwError } from '@moviebooking/common';
import { BookingStatus, canTransitionBooking } from '@moviebooking/database';

/**
 * Throws BUSINESS_RULE_VIOLATION when `from -> to` is not an allowed move.
 * The transition table lives in libs/database (BOOKING_TRANSITIONS) so the
 * seat-conflict repair command applies the same rules.
 */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransitionBooking(from, to)) {
    throwError(
      'BUSINESS_RULE_VIOLATION',
      `Invalid booking status transition: ${from} -> ${to}`,
    );
  }
}
