import { BookingStatus } from '../enums';
import {
  BOOKING_TRANSITIONS,
  canTransitionBooking,
} from './booking-transitions';

describe('booking state machine', () => {
  it.each([
    [BookingStatus.HOLDING, BookingStatus.PAYMENT_PENDING],
    [BookingStatus.HOLDING, BookingStatus.EXPIRED],
    [BookingStatus.HOLDING, BookingStatus.FAILED],
    [BookingStatus.PAYMENT_PENDING, BookingStatus.CONFIRMED],
    [BookingStatus.PAYMENT_PENDING, BookingStatus.EXPIRED],
    [BookingStatus.PAYMENT_PENDING, BookingStatus.PENDING_REVIEW],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(true);
  });

  it.each([
    [BookingStatus.CONFIRMED, BookingStatus.EXPIRED],
    [BookingStatus.HOLDING, BookingStatus.CONFIRMED],
    [BookingStatus.PENDING_REVIEW, BookingStatus.EXPIRED],
    [BookingStatus.EXPIRED, BookingStatus.HOLDING],
  ])('refuses %s -> %s', (from, to) => {
    expect(canTransitionBooking(from, to)).toBe(false);
  });

  it('has terminal states with no way out and nothing leading back to HOLDING', () => {
    for (const terminal of [
      BookingStatus.CONFIRMED,
      BookingStatus.FAILED,
      BookingStatus.EXPIRED,
      BookingStatus.PENDING_REVIEW,
    ]) {
      expect(BOOKING_TRANSITIONS[terminal]).toEqual([]);
    }
    for (const targets of Object.values(BOOKING_TRANSITIONS)) {
      expect(targets).not.toContain(BookingStatus.HOLDING);
    }
  });
});
