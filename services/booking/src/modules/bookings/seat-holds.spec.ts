import { EntityManager } from 'typeorm';
import { SeatHold, SeatHoldStatus } from '@moviebooking/database';
import { HoldOutcome, settleActiveHolds } from './seat-holds';

describe('settleActiveHolds', () => {
  const manager = () =>
    ({
      update: jest.fn().mockResolvedValue({ affected: 2 }),
    }) as unknown as EntityManager & {
      update: jest.Mock;
    };

  it.each([
    SeatHoldStatus.CONVERTED,
    SeatHoldStatus.EXPIRED,
    SeatHoldStatus.RELEASED,
  ] as HoldOutcome[])('moves only ACTIVE holds to %s', async (outcome) => {
    const m = manager();
    await settleActiveHolds(m, 7, outcome);
    expect(m.update).toHaveBeenCalledWith(
      SeatHold,
      { bookingId: 7, status: SeatHoldStatus.ACTIVE },
      { status: outcome },
    );
  });

  it('refuses to move holds back to ACTIVE (CONVERTED can never be reactivated)', async () => {
    const m = manager();
    await expect(
      settleActiveHolds(m, 7, SeatHoldStatus.ACTIVE as unknown as HoldOutcome),
    ).rejects.toThrow('cannot be moved back to ACTIVE');
    expect(m.update).not.toHaveBeenCalled();
  });
});
