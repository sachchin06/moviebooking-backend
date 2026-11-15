import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { createSqlServerOptions } from '@moviebooking/database';
import { readIntegrationEnv, testDbReader } from './env';

/**
 * Runs once before the integration suite: drops and recreates the _test database,
 * then applies every migration (the compiled ones in libs/database/dist, so build
 * the libraries first), exactly as production would.
 */
export default async function globalSetup(): Promise<void> {
  const env = readIntegrationEnv();

  // The identity seed migration needs an initial admin.
  process.env.ADMIN_NAME ??= 'Integration Admin';
  process.env.ADMIN_EMAIL ??= 'admin@integration.test';
  process.env.ADMIN_PASSWORD ??= 'Integration-Admin-1';

  const master = new DataSource({
    ...createSqlServerOptions(testDbReader(env, 'master'), { entities: [] }),
    logging: false,
  });
  await master.initialize();
  try {
    const db = env.db.name; // validated: [A-Za-z0-9_]+_test
    await master.query(`
      IF DB_ID('${db}') IS NOT NULL
      BEGIN
        ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${db}];
      END;
      CREATE DATABASE [${db}];
    `);
  } finally {
    await master.destroy();
  }

  const distDir = path.dirname(require.resolve('@moviebooking/database'));
  const migrations = path
    .join(distDir, 'migrations', '*.js')
    .replace(/\\/g, '/');

  const dataSource = new DataSource({
    ...createSqlServerOptions(testDbReader(env), {
      entities: [],
      migrations: [migrations],
    }),
    logging: false,
  });
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length === 0) {
      throw new Error(
        `No migrations found in ${migrations}. Run "npm run build:libs" first.`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}
