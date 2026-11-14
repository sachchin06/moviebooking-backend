import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { createSqlServerOptions } from './typeorm-config';

// Load environment variables (the migration CLI runs from libs/database)
dotenv.config({ path: '../../.env' });

export const dataSourceOptions = createSqlServerOptions(
  (key) => process.env[key],
  {
    entities: [__dirname + '/entities/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
  },
);

export const AppDataSource = new DataSource(dataSourceOptions);
