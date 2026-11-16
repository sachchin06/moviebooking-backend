import { BookingStatus } from '../enums';

/**
 * The booking state machine: which status may follow which. Terminal states map to
 * an empty list, and nothing moves back into HOLDING (it only exists at creation).
 *
 * Shared by the Booking Service (assertTransition) and the seat-conflict repair
 * command, so both follow exactly the same rules.
 */
export const BOOKING_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  [BookingStatus.HOLDING]: [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.EXPIRED,
    BookingStatus.FAILED,
  ],
  [BookingStatus.PAYMENT_PENDING]: [
    BookingStatus.CONFIRMED,
    BookingStatus.FAILED,
    BookingStatus.EXPIRED,
    BookingStatus.PENDING_REVIEW,
  ],
  [BookingStatus.CONFIRMED]: [],
  [BookingStatus.FAILED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.PENDING_REVIEW]: [],
};

export function canTransitionBooking(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}
