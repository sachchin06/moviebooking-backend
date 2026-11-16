import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Database guarantee against double-booking.
 *
 * Before: confirmed bookings moved their holds to RELEASED, which took the seat out
 * of the filtered unique index (WHERE status = 'ACTIVE'). From then on only
 * application code kept a sold seat from being held again.
 *
 * After: confirmed holds become CONVERTED, and the unique index covers
 * (show_id, seat_id) WHERE status IN ('ACTIVE', 'CONVERTED'), so SQL Server itself
 * refuses a second live hold on a held or sold seat.
 *
 * TypeORM runs each migration in a transaction, so a failure leaves nothing changed.
 */
export class M7ConvertedHolds1704931200000 implements MigrationInterface {
  name = 'M7ConvertedHolds1704931200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Holds of confirmed bookings are sold seats.
    await queryRunner.query(`
      UPDATE h
      SET h.status = 'CONVERTED', h.updated_at = GETDATE()
      FROM seat_holds h
      INNER JOIN bookings b ON b.id = h.booking_id
      WHERE b.status = 'CONFIRMED' AND h.status = 'RELEASED'
    `);

    // 2. Refuse to continue if existing data already breaks the new rule.
    const conflicts: {
      show_id: number;
      seat_id: number;
      live_holds: number;
    }[] = await queryRunner.query(`
        SELECT show_id, seat_id, COUNT(*) AS live_holds
        FROM seat_holds
        WHERE status IN ('ACTIVE', 'CONVERTED')
        GROUP BY show_id, seat_id
        HAVING COUNT(*) > 1
      `);

    if (conflicts.length > 0) {
      const list = conflicts
        .slice(0, 20)
        .map(
          (c) =>
            `show ${c.show_id} seat ${c.seat_id} (${c.live_holds} live holds)`,
        )
        .join('; ');
      throw new Error(
        `Cannot create idx_seat_holds_unique_live: ${conflicts.length} seat(s) are ` +
          `held or sold more than once: ${list}. Resolve these bookings by hand ` +
          `(release or expire the duplicate holds), then run the migration again.`,
      );
    }

    // 3. Swap the index.
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_seat_holds_unique_active ON seat_holds`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_seat_holds_unique_live
      ON seat_holds (show_id, seat_id)
      WHERE status IN ('ACTIVE', 'CONVERTED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_seat_holds_unique_live ON seat_holds`,
    );
    await queryRunner.query(
      `UPDATE seat_holds SET status = 'RELEASED', updated_at = GETDATE() WHERE status = 'CONVERTED'`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_seat_holds_unique_active
      ON seat_holds (show_id, seat_id)
      WHERE status = 'ACTIVE'
    `);
  }
}
