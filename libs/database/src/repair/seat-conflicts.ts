import { DataSource, EntityManager } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { SeatHold } from '../entities/seat-hold.entity';
import { BookingStatus, SeatHoldStatus } from '../enums';
import { canTransitionBooking } from '../domain/booking-transitions';

/**
 * Seat-conflict repair: finds seats claimed by more than one booking and, where
 * the answer is unambiguous, expires the losing bookings.
 *
 * Migration M7 refuses to create the live-hold unique index while such seats exist,
 * by design: deciding who keeps a seat is a business decision, not a schema change.
 * This command is that decision, made explicit and logged.
 *
 * A "claim" on a seat is a hold that occupies it: ACTIVE, CONVERTED, or (before M7
 * has run) RELEASED but belonging to a CONFIRMED booking. This is exactly what
 * M7's own conflict check counts.
 */

export interface SeatClaim {
  holdId: number;
  showId: number;
  seatId: number;
  holdStatus: SeatHoldStatus;
  bookingId: number;
  bookingRef: string;
  bookingStatus: BookingStatus;
}

/** Exactly one CONFIRMED booking keeps the seat; the other claimants expire. */
export interface SafeRepair {
  showId: number;
  seatId: number;
  keep: SeatClaim;
  expire: SeatClaim[];
}

/** Ambiguous or money-involving conflicts: nothing is changed. */
export interface ManualReview {
  showId: number;
  seatId: number;
  reason: string;
  claims: SeatClaim[];
}

export interface RepairPlan {
  safe: SafeRepair[];
  manual: ManualReview[];
}

export interface RepairResult {
  plan: RepairPlan;
  applied: boolean;
  expiredBookings: number;
  expiredHolds: number;
}

export type RepairLog = (line: string) => void;

const CLAIMS_SQL = `
  WITH claims AS (
    SELECT h.id AS holdId, h.show_id AS showId, h.seat_id AS seatId,
           h.status AS holdStatus, b.id AS bookingId, b.booking_ref AS bookingRef,
           b.status AS bookingStatus,
           COUNT(*) OVER (PARTITION BY h.show_id, h.seat_id) AS claimCount
    FROM seat_holds h
    INNER JOIN bookings b ON b.id = h.booking_id
    WHERE h.status IN ('ACTIVE', 'CONVERTED')
       OR (h.status = 'RELEASED' AND b.status = 'CONFIRMED')
  )
  SELECT holdId, showId, seatId, holdStatus, bookingId, bookingRef, bookingStatus
  FROM claims
  WHERE claimCount > 1
  ORDER BY showId, seatId, holdId
`;

/** Every claim on a seat that has more than one claim. */
export async function findSeatClaims(
  manager: EntityManager,
): Promise<SeatClaim[]> {
  const rows: SeatClaim[] = await manager.query(CLAIMS_SQL);
  return rows.map((r) => ({
    ...r,
    holdId: Number(r.holdId),
    showId: Number(r.showId),
    seatId: Number(r.seatId),
    bookingId: Number(r.bookingId),
  }));
}

/** Decides, seat by seat, whether a conflict is safe to repair. Pure function. */
export function planRepair(claims: SeatClaim[]): RepairPlan {
  const bySeat = new Map<string, SeatClaim[]>();
  for (const claim of claims) {
    const key = `${claim.showId}:${claim.seatId}`;
    bySeat.set(key, [...(bySeat.get(key) ?? []), claim]);
  }

  const plan: RepairPlan = { safe: [], manual: [] };
  for (const seatClaims of bySeat.values()) {
    const { showId, seatId } = seatClaims[0];
    const confirmed = seatClaims.filter(
      (c) => c.bookingStatus === BookingStatus.CONFIRMED,
    );
    const others = seatClaims.filter(
      (c) => c.bookingStatus !== BookingStatus.CONFIRMED,
    );

    if (confirmed.length >= 2) {
      plan.manual.push({
        showId,
        seatId,
        reason: `DOUBLE_SALE: ${confirmed.length} confirmed bookings hold this seat; a refund is needed`,
        claims: seatClaims,
      });
    } else if (confirmed.length === 0) {
      plan.manual.push({
        showId,
        seatId,
        reason: 'NO_CONFIRMED_OWNER: no confirmed booking to keep the seat',
        claims: seatClaims,
      });
    } else if (
      others.some((c) => c.bookingStatus === BookingStatus.PENDING_REVIEW)
    ) {
      plan.manual.push({
        showId,
        seatId,
        reason:
          'PAID_CLAIMANT: a PENDING_REVIEW booking (payment received) also holds this seat',
        claims: seatClaims,
      });
    } else {
      plan.safe.push({ showId, seatId, keep: confirmed[0], expire: others });
    }
  }
  return plan;
}

/**
 * Applies the safe repairs inside the caller's transaction. Each losing booking is
 * row-locked (ascending ID order, like the Booking Service), then:
 * - HOLDING or PAYMENT_PENDING: moves to EXPIRED through the shared state machine,
 *   and all of its ACTIVE holds become EXPIRED (a reservation expires as one unit);
 * - already FAILED or EXPIRED (a stale ACTIVE hold): only its ACTIVE holds expire.
 * Every change is logged.
 */
export async function applyRepair(
  manager: EntityManager,
  plan: RepairPlan,
  log: RepairLog,
): Promise<{ expiredBookings: number; expiredHolds: number }> {
  const bookingIds = [
    ...new Set(plan.safe.flatMap((r) => r.expire.map((c) => c.bookingId))),
  ].sort((a, b) => a - b);

  let expiredBookings = 0;
  let expiredHolds = 0;

  for (const id of bookingIds) {
    const booking = await manager.findOne(Booking, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!booking) {
      continue;
    }

    if (canTransitionBooking(booking.status, BookingStatus.EXPIRED)) {
      log(
        `booking ${booking.bookingRef} (id ${id}): ${booking.status} -> EXPIRED`,
      );
      booking.status = BookingStatus.EXPIRED;
      await manager.save(Booking, booking);
      expiredBookings++;
    } else {
      log(
        `booking ${booking.bookingRef} (id ${id}): stays ${booking.status}; only its stale ACTIVE holds are expired`,
      );
    }

    const holds = await manager.find(SeatHold, {
      where: { bookingId: id, status: SeatHoldStatus.ACTIVE },
    });
    for (const hold of holds) {
      log(
        `  hold ${hold.id} (show ${hold.showId}, seat ${hold.seatId}): ACTIVE -> EXPIRED`,
      );
    }
    await manager.update(
      SeatHold,
      { bookingId: id, status: SeatHoldStatus.ACTIVE },
      { status: SeatHoldStatus.EXPIRED },
    );
    expiredHolds += holds.length;
  }

  return { expiredBookings, expiredHolds };
}

/** Human-readable report of a plan. */
export function formatPlan(plan: RepairPlan): string[] {
  const describe = (c: SeatClaim) =>
    `${c.bookingRef} (${c.bookingStatus}, hold ${c.holdId} ${c.holdStatus})`;
  const lines = [
    `Seats with conflicting claims: ${plan.safe.length + plan.manual.length}`,
    `  safe to repair: ${plan.safe.length}`,
    `  needing manual review: ${plan.manual.length}`,
  ];
  for (const r of plan.safe) {
    lines.push(
      `SAFE   show ${r.showId} seat ${r.seatId}: keep ${describe(r.keep)}; expire ${r.expire.map(describe).join(', ')}`,
    );
  }
  for (const m of plan.manual) {
    lines.push(
      `REVIEW show ${m.showId} seat ${m.seatId}: ${m.reason}: ${m.claims.map(describe).join(', ')}`,
    );
  }
  return lines;
}

/**
 * Finds and reports conflicts; with apply=true also repairs the safe ones, all in
 * one transaction (any error rolls everything back).
 */
export async function repairSeatConflicts(
  dataSource: DataSource,
  options: { apply: boolean; log: RepairLog },
): Promise<RepairResult> {
  return dataSource.transaction(async (manager) => {
    const plan = planRepair(await findSeatClaims(manager));
    formatPlan(plan).forEach((line) => options.log(line));

    if (!options.apply || plan.safe.length === 0) {
      options.log(
        options.apply
          ? 'Nothing safe to repair.'
          : 'Dry run: nothing was changed. Run with --apply to repair the SAFE seats.',
      );
      return { plan, applied: false, expiredBookings: 0, expiredHolds: 0 };
    }

    options.log('Applying safe repairs:');
    const counts = await applyRepair(manager, plan, options.log);
    options.log(
      `Done: ${counts.expiredBookings} booking(s) and ${counts.expiredHolds} hold(s) expired.`,
    );
    return { plan, applied: true, ...counts };
  });
}
