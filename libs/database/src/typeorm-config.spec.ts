import { createSqlServerOptions, EnvReader } from './typeorm-config';

const envFrom =
  (values: Record<string, string>): EnvReader =>
  (key) =>
    values[key];

describe('createSqlServerOptions', () => {
  it('reads the connection settings from the environment', () => {
    const options = createSqlServerOptions(
      envFrom({
        DB_HOST: 'db.internal',
        DB_PORT: '1444',
        DB_USERNAME: 'app',
        DB_PASSWORD: 'secret',
        DB_DATABASE: 'bookings',
      }),
      { entities: [] },
    );

    expect(options).toMatchObject({
      type: 'mssql',
      host: 'db.internal',
      port: 1444,
      username: 'app',
      password: 'secret',
      database: 'bookings',
      synchronize: false,
    });
  });

  it('encrypts and checks the server certificate by default', () => {
    const options = createSqlServerOptions(envFrom({}), { entities: [] });
    expect(options.options).toEqual({
      encrypt: true,
      trustServerCertificate: false,
    });
  });

  it('turns encryption off and trusts the certificate in development', () => {
    const options = createSqlServerOptions(
      envFrom({ NODE_ENV: 'development' }),
      { entities: [] },
    );
    expect(options.options).toEqual({
      encrypt: false,
      trustServerCertificate: true,
    });
  });

  it('lets DB_ENCRYPT and DB_TRUST_SERVER_CERTIFICATE override the defaults', () => {
    const options = createSqlServerOptions(
      envFrom({
        NODE_ENV: 'development',
        DB_ENCRYPT: 'true',
        DB_TRUST_SERVER_CERTIFICATE: 'false',
      }),
      { entities: [] },
    );
    expect(options.options).toEqual({
      encrypt: true,
      trustServerCertificate: false,
    });
  });

  it('rejects a value that is not true or false', () => {
    expect(() =>
      createSqlServerOptions(envFrom({ DB_ENCRYPT: 'yes please' }), {
        entities: [],
      }),
    ).toThrow('DB_ENCRYPT must be true or false');
  });
});
