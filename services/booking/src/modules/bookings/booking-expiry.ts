import { EntityManager } from 'typeorm';
import { Booking, BookingStatus, SeatHoldStatus } from '@moviebooking/database';
import { assertTransition } from './booking-state';
import { settleActiveHolds } from './seat-holds';

/** True when a HOLDING or PAYMENT_PENDING booking has passed its deadline. */
export function isOverdue(booking: Booking, now: Date): boolean {
  if (booking.status === BookingStatus.HOLDING) {
    return !!booking.holdExpiresAt && booking.holdExpiresAt <= now;
  }
  if (booking.status === BookingStatus.PAYMENT_PENDING) {
    return !!booking.paymentExpiresAt && booking.paymentExpiresAt <= now;
  }
  return false;
}

/**
 * Expires one booking inside the caller's transaction. The caller must already hold
 * the booking's row lock (pessimistic_write) so the status cannot change underneath.
 * Re-checks the deadline under that lock: a payment or cancellation may have won.
 * Returns true when the booking was expired (and its ACTIVE holds with it).
 * Used by the expiry sweep and by the hold transaction's stale-hold reclaim.
 */
export async function expireLockedBooking(
  manager: EntityManager,
  booking: Booking,
  now: Date,
): Promise<boolean> {
  if (!isOverdue(booking, now)) {
    return false;
  }

  assertTransition(booking.status, BookingStatus.EXPIRED);
  booking.status = BookingStatus.EXPIRED;
  await manager.save(Booking, booking);

  await settleActiveHolds(manager, booking.id, SeatHoldStatus.EXPIRED);
  return true;
}
