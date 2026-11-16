import { EntityManager } from 'typeorm';
import { SeatHold, SeatHoldStatus } from '@moviebooking/database';

/** Statuses an ACTIVE hold may move to. ACTIVE itself is not a valid target. */
export type HoldOutcome =
  | SeatHoldStatus.CONVERTED
  | SeatHoldStatus.EXPIRED
  | SeatHoldStatus.RELEASED;

/**
 * The only way booking code changes a hold's status.
 *
 * Hold lifecycle: a hold is created ACTIVE and leaves ACTIVE exactly once — to
 * CONVERTED (confirmed), EXPIRED (deadline passed) or RELEASED (cancelled, failed,
 * late payment). Because this updates only rows that are still ACTIVE, a CONVERTED,
 * EXPIRED or RELEASED hold can never be changed again, and in particular a sold
 * (CONVERTED) seat can never return to ACTIVE.
 */
export async function settleActiveHolds(
  manager: EntityManager,
  bookingId: number,
  outcome: HoldOutcome,
): Promise<void> {
  if ((outcome as SeatHoldStatus) === SeatHoldStatus.ACTIVE) {
    throw new Error('A hold cannot be moved back to ACTIVE');
  }
  await manager.update(
    SeatHold,
    { bookingId, status: SeatHoldStatus.ACTIVE },
    { status: outcome },
  );
}
