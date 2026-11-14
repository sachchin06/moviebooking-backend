import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { SkipTransform, InternalApiGuard } from '@moviebooking/common';
import { InternalBookingsService } from './internal-bookings.service';
import { InternalTransitionsService } from './internal-transitions.service';
import { BookingExistsQueryDto } from './dto/booking-exists-query.dto';

@ApiTags('internal')
@UseGuards(InternalApiGuard)
@Controller('internal/bookings')
export class InternalBookingsController {
  constructor(
    private readonly internalBookingsService: InternalBookingsService,
    private readonly internalTransitionsService: InternalTransitionsService,
  ) {}

  // Declared before ':bookingRef' so "exists" is not captured as a booking reference.
  @Get('exists')
  @SkipTransform()
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Whether a show has live bookings (internal)',
    description:
      'Counts bookings in HOLDING, PAYMENT_PENDING, CONFIRMED or PENDING_REVIEW. Used by the Show Service before rescheduling or deleting a show.',
  })
  async exists(@Query() query: BookingExistsQueryDto) {
    return this.internalBookingsService.existsForShow(query.showId);
  }

  @Get(':bookingRef')
  @SkipTransform()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get booking by reference (internal)' })
  @ApiResponse({ status: 200, description: 'Booking found' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async getByReference(@Param('bookingRef') bookingRef: string) {
    return this.internalBookingsService.getByReference(bookingRef);
  }

  @Post(':bookingRef/mark-payment-pending')
  @SkipTransform()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Mark booking as payment pending (internal)' })
  @ApiResponse({
    status: 200,
    description: 'Booking marked as payment pending',
  })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async markPaymentPending(@Param('bookingRef') bookingRef: string) {
    return this.internalTransitionsService.markPaymentPending(bookingRef);
  }

  @Post(':bookingRef/confirm')
  @SkipTransform()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Confirm booking after payment (internal)' })
  @ApiResponse({ status: 200, description: 'Booking confirmed' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async confirmBooking(@Param('bookingRef') bookingRef: string) {
    return this.internalTransitionsService.confirmBooking(bookingRef);
  }

  @Post(':bookingRef/fail')
  @SkipTransform()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Fail booking (internal)' })
  @ApiResponse({ status: 200, description: 'Booking marked as failed' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async failBooking(@Param('bookingRef') bookingRef: string) {
    return this.internalTransitionsService.failBooking(bookingRef);
  }
}
