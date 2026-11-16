/* eslint-disable no-console -- a command-line tool: console output is its interface */
/**
 * npm run db:repair-seat-conflicts              (dry run: report only)
 * npm run db:repair-seat-conflicts -- --apply   (repair the safe seats)
 *
 * Exit codes: 0 = done; 1 = error; 2 = seats need manual review (nothing was
 * changed for those seats).
 */
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';
import { repairSeatConflicts } from './seat-conflicts';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply' && a !== '--dry-run');
  if (
    unknown.length > 0 ||
    (args.includes('--apply') && args.includes('--dry-run'))
  ) {
    console.error('Usage: db:repair-seat-conflicts [--dry-run | --apply]');
    return 1;
  }
  const apply = args.includes('--apply');

  // Same connection settings as the migrations, without echoed SQL
  // (NODE_ENV=development turns it on), which would bury the report.
  const dataSource = new DataSource({ ...dataSourceOptions, logging: false });
  await dataSource.initialize();
  try {
    const result = await repairSeatConflicts(dataSource, {
      apply,
      log: (line) => console.log(line),
    });
    if (result.plan.manual.length > 0) {
      console.log(
        `${result.plan.manual.length} seat(s) need manual review; migration M7 will keep refusing until they are resolved.`,
      );
      return 2;
    }
    return 0;
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Repair failed, nothing was changed: ${error.message}`);
    process.exit(1);
  });
