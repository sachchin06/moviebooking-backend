// M2: Identity Service enums
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

// M3: Theatre Service enums
export enum TheatreStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum TheatreAdminStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum ScreenStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum SeatType {
  STANDARD = 'STANDARD',
  VIP = 'VIP',
}

export enum SeatStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// M4: Movie Service enums
export enum MovieStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum MovieRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// M5: Show Service enums
export enum ShowStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ShowSeatStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  SOLD = 'SOLD',
}

// M6: Booking Service enums
export enum BookingStatus {
  HOLDING = 'HOLDING',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  PENDING_REVIEW = 'PENDING_REVIEW',
}

/**
 * ACTIVE and CONVERTED holds both occupy their seat: the filtered unique index on
 * seat_holds (show_id, seat_id) WHERE status IN ('ACTIVE', 'CONVERTED') allows only one.
 * - ACTIVE: reserved, waiting for payment
 * - CONVERTED: the booking was confirmed; the seat is sold
 * - EXPIRED / RELEASED: no longer occupies the seat
 */
export enum SeatHoldStatus {
  ACTIVE = 'ACTIVE',
  CONVERTED = 'CONVERTED',
  EXPIRED = 'EXPIRED',
  RELEASED = 'RELEASED',
}
