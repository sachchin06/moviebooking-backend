import { INestApplication, Logger, Type, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { INTERNAL_API_KEY_ENV } from '../guards/internal-api.guard';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { TransformInterceptor } from '../interceptors/transform.interceptor';
import { assertRequiredEnv } from '../utils/env.util';
import { initIdCipher } from '../utils/id-cipher.util';

export interface BootstrapServiceOptions {
  /** Human-readable name used in logs, e.g. "Booking Service". */
  serviceName: string;
  /** The service's own port variable, e.g. "BOOKING_SERVICE_PORT". */
  portEnvKey: string;
  defaultPort: number;
  swagger: {
    title: string;
    description: string;
    /** Security scheme name used by this service's @ApiBearerAuth() decorators. */
    bearerName?: string;
    tags?: [name: string, description: string][];
  };
  /** ValidationPipe implicit type conversion (default true). */
  implicitConversion?: boolean;
}

/**
 * Creates and starts a service with the set-up every service shares: required
 * environment, ID cipher, /api prefix, helmet, CORS, validation, error filter,
 * logging and response interceptors, Swagger (outside production) and the port.
 */
export async function bootstrapService(
  appModule: Type<unknown>,
  options: BootstrapServiceOptions,
): Promise<INestApplication> {
  // Refuse to start without the key that protects /internal routes.
  assertRequiredEnv([INTERNAL_API_KEY_ENV]);

  const app = await NestFactory.create(appModule);
  const config = app.get(ConfigService);
  const logger = new Logger(options.serviceName);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  initIdCipher();
  app.setGlobalPrefix('api');

  // Security headers. Swagger UI (development only) needs inline scripts and
  // styles, so the Content-Security-Policy header is only sent in production.
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGIN'));
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    logger.warn(
      'CORS_ORIGIN not set: cross-origin browser requests are blocked',
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: options.implicitConversion ?? true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(app.get(Reflector)),
  );

  if (!isProduction) {
    setUpSwagger(app, options.swagger);
  }

  const port = parsePort(config.get<string>(options.portEnvKey), options);
  await app.listen(port);

  logger.log(`${options.serviceName} running on port ${port}`);
  if (!isProduction) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  }
  return app;
}

/**
 * Parses CORS_ORIGIN, a comma-separated list of allowed origins. Returns false when
 * it is not set (CORS disabled). A wildcard is refused: with credentials enabled it
 * would let any website make authenticated requests.
 */
export function parseCorsOrigins(value: string | undefined): string[] | false {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return false;
  }
  if (origins.includes('*')) {
    throw new Error(
      'CORS_ORIGIN must list explicit origins; "*" is not allowed',
    );
  }
  return origins;
}

function parsePort(
  value: string | undefined,
  options: BootstrapServiceOptions,
): number {
  if (value === undefined || value === '') {
    return options.defaultPort;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${options.portEnvKey} must be a port number, got "${value}"`,
    );
  }
  return port;
}

function setUpSwagger(
  app: INestApplication,
  swagger: BootstrapServiceOptions['swagger'],
): void {
  const builder = new DocumentBuilder()
    .setTitle(swagger.title)
    .setDescription(swagger.description)
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      swagger.bearerName ?? 'bearer',
    );
  for (const [name, description] of swagger.tags ?? []) {
    builder.addTag(name, description);
  }

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
