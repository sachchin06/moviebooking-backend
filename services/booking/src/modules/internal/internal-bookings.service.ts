import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Booking, BookingStatus } from '../../entities';

/** Statuses that hold, or may still hold, seats for a show. */
export const LIVE_BOOKING_STATUSES = [
  BookingStatus.HOLDING,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_REVIEW,
];
import { throwError } from '@moviebooking/common';
import { mapReservationTiming } from '../bookings/reservation-timing.mapper';

/** Internal service for Payment Service integration. */
@Injectable()
export class InternalBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {}

  /** Whether any live booking exists for the show. */
  async existsForShow(showId: number): Promise<{ exists: boolean }> {
    const exists = await this.bookingRepository.exists({
      where: { showId, status: In(LIVE_BOOKING_STATUSES) },
    });
    return { exists };
  }

  /** Returns raw booking data for Payment Service. */
  async getByReference(bookingRef: string) {
    const booking = await this.bookingRepository.findOne({
      where: { bookingRef },
      relations: ['seats'],
    });

    if (!booking) {
      throwError('NOT_FOUND', 'Booking not found');
    }

    const timing = mapReservationTiming(booking);

    return {
      id: booking.id,
      bookingRef: booking.bookingRef,
      showId: booking.showId,
      email: booking.email,
      status: booking.status,
      totalAmountCents: booking.totalAmountCents,
      currency: booking.currency,
      holdExpiresAt: timing.holdExpiresAt,
      paymentExpiresAt: timing.paymentExpiresAt,
      activeExpiresAt: timing.activeExpiresAt,
      remainingSeconds: timing.remainingSeconds,
      createdAt: booking.createdAt?.toISOString() || null,
      updatedAt: booking.updatedAt?.toISOString() || null,
      seats: booking.seats.map((bs) => ({
        seatId: bs.seatId,
        seatType: bs.seatType,
        priceCents: bs.priceCents,
      })),
    };
  }
}
