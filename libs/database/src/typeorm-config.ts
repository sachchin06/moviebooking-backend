import { DataSourceOptions } from 'typeorm';
import { SqlServerConnectionOptions } from 'typeorm/driver/sqlserver/SqlServerConnectionOptions';

/** Reads one environment value (ConfigService.get or process.env). */
export type EnvReader = (key: string) => string | undefined;

export interface SqlServerConfigOptions {
  entities: DataSourceOptions['entities'];
  migrations?: DataSourceOptions['migrations'];
}

/**
 * SQL Server connection options shared by every service and the migration CLI.
 *
 * Connection encryption is on by default; only NODE_ENV=development turns it off and
 * trusts a self-signed server certificate, as a local SQL Server usually has one.
 * DB_ENCRYPT and DB_TRUST_SERVER_CERTIFICATE override either default.
 */
export function createSqlServerOptions(
  env: EnvReader,
  options: SqlServerConfigOptions,
): SqlServerConnectionOptions {
  const isDevelopment = env('NODE_ENV') === 'development';

  return {
    type: 'mssql',
    host: env('DB_HOST') || 'localhost',
    port: parseInt(env('DB_PORT') || '1433', 10),
    username: env('DB_USERNAME') || 'sa',
    password: env('DB_PASSWORD') || '',
    database: env('DB_DATABASE') || 'moviebooking_db',
    entities: options.entities,
    migrations: options.migrations ?? [],
    synchronize: false, // schema changes only through migrations
    logging: isDevelopment,
    options: {
      encrypt: parseBoolean('DB_ENCRYPT', env('DB_ENCRYPT'), !isDevelopment),
      trustServerCertificate: parseBoolean(
        'DB_TRUST_SERVER_CERTIFICATE',
        env('DB_TRUST_SERVER_CERTIFICATE'),
        isDevelopment,
      ),
    },
  };
}

function parseBoolean(
  name: string,
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'true' || normalised === '1') return true;
  if (normalised === 'false' || normalised === '0') return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}
