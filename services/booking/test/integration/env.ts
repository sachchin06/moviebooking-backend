import * as path from 'path';
import * as dotenv from 'dotenv';
import type { EnvReader } from '@moviebooking/database';

// Optional local settings file at the repository root (git-ignored).
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.test') });

export interface IntegrationEnv {
  db: {
    host: string;
    port: string;
    username: string;
    password: string;
    name: string;
    encrypt: string;
    trustServerCertificate: string;
  };
  redis: { host: string; port: number; password?: string; db: number };
  rabbitmqUrl: string;
}

const REQUIRED = [
  'TEST_DB_HOST',
  'TEST_DB_USERNAME',
  'TEST_DB_PASSWORD',
  'TEST_DB_NAME',
  'TEST_REDIS_HOST',
  'TEST_RABBITMQ_URL',
];

/**
 * Reads the integration settings. Refuses to continue unless the database name ends
 * in _test, because the suite drops and recreates that database before every run.
 */
export function readIntegrationEnv(): IntegrationEnv {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Integration tests need ${missing.join(', ')} (see DEVELOPMENT.md, "Integration tests").`,
    );
  }

  const name = process.env.TEST_DB_NAME as string;
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to run: TEST_DB_NAME "${name}" must end in "_test" (letters, digits and ` +
        `underscores only), because the integration suite drops and recreates it.`,
    );
  }

  return {
    db: {
      host: process.env.TEST_DB_HOST as string,
      port: process.env.TEST_DB_PORT ?? '1433',
      username: process.env.TEST_DB_USERNAME as string,
      password: process.env.TEST_DB_PASSWORD as string,
      name,
      // Throwaway test servers usually have a self-signed certificate.
      encrypt: process.env.TEST_DB_ENCRYPT ?? 'false',
      trustServerCertificate:
        process.env.TEST_DB_TRUST_SERVER_CERTIFICATE ?? 'true',
    },
    redis: {
      host: process.env.TEST_REDIS_HOST as string,
      port: Number(process.env.TEST_REDIS_PORT ?? 6379),
      password: process.env.TEST_REDIS_PASSWORD || undefined,
      // A separate logical database so tests never touch development lock keys.
      db: Number(process.env.TEST_REDIS_DB ?? 15),
    },
    rabbitmqUrl: process.env.TEST_RABBITMQ_URL as string,
  };
}

/** Maps createSqlServerOptions' DB_* keys onto the TEST_DB_* settings. */
export function testDbReader(
  env: IntegrationEnv,
  database = env.db.name,
): EnvReader {
  const values: Record<string, string> = {
    DB_HOST: env.db.host,
    DB_PORT: env.db.port,
    DB_USERNAME: env.db.username,
    DB_PASSWORD: env.db.password,
    DB_DATABASE: database,
    DB_ENCRYPT: env.db.encrypt,
    DB_TRUST_SERVER_CERTIFICATE: env.db.trustServerCertificate,
  };
  return (key) => values[key];
}
