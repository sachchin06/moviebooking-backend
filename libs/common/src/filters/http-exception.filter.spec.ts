import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { HttpExceptionFilter } from './http-exception.filter';

interface CapturedResponse {
  status?: number;
  body?: {
    success: boolean;
    error: { code: string; message: string; details?: unknown[] };
    meta: { requestId?: string };
  };
}

function run(exception: unknown): CapturedResponse {
  const captured: CapturedResponse = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: CapturedResponse['body']) {
      captured.body = body;
      return this;
    },
  };
  const request = {
    method: 'GET',
    url: '/api/things/1',
    headers: { 'x-request-id': 'req-123' },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);
  return captured;
}

/** Mimics TypeORM's QueryFailedError, which copies the driver's error number. */
function sqlServerError(number: number): Error {
  return Object.assign(new Error(`SQL Server error ${number} on table users`), {
    name: 'QueryFailedError',
    number,
  });
}

describe('HttpExceptionFilter', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('turns ValidationPipe errors into VALIDATION_ERROR with details', () => {
    const result = run(
      new BadRequestException({
        message: ['email must be an email', 'seatIds should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    expect(result.status).toBe(400);
    expect(result.body?.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [
        { message: 'email must be an email' },
        { message: 'seatIds should not be empty' },
      ],
    });
    expect(result.body?.meta.requestId).toBe('req-123');
  });

  it('returns an AppException with its own status, code and message', () => {
    const result = run(
      new AppException('BUSINESS_RULE_VIOLATION', 'Seat 4 is sold'),
    );

    expect(result.status).toBe(422);
    expect(result.body?.success).toBe(false);
    expect(result.body?.error).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'Seat 4 is sold',
    });
  });

  it('maps a standard HttpException status to a code', () => {
    const result = run(new NotFoundException('Cannot GET /api/nope'));
    expect(result.status).toBe(404);
    expect(result.body?.error.code).toBe('NOT_FOUND');
  });

  it.each([
    [
      2627,
      409,
      'DUPLICATE_RESOURCE',
      'A record with the same value already exists',
    ],
    [
      2601,
      409,
      'DUPLICATE_RESOURCE',
      'A record with the same value already exists',
    ],
    [
      547,
      400,
      'VALIDATION_ERROR',
      'Referenced record does not exist or cannot be removed',
    ],
    [515, 400, 'VALIDATION_ERROR', 'A required field is missing'],
  ])(
    'maps SQL Server error %i to %i %s without leaking the SQL message',
    (number, status, code, message) => {
      const result = run(sqlServerError(number));

      expect(result.status).toBe(status);
      expect(result.body?.error).toMatchObject({ code, message });
      expect(JSON.stringify(result.body)).not.toContain('table users');
    },
  );

  it('hides the message of an unknown error but logs it in full', () => {
    const secret = new Error('ENOENT: /srv/app/config/secrets.json not found');

    const result = run(secret);

    expect(result.status).toBe(500);
    expect(result.body?.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(result.body)).not.toContain('secrets.json');
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('secrets.json'),
      secret.stack,
    );
    expect(errorLog.mock.calls[0][0]).toContain('GET /api/things/1');
  });

  it('handles a thrown value that is not an Error', () => {
    const result = run('something odd');

    expect(result.status).toBe(500);
    expect(result.body?.error.message).toBe('Internal server error');
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('something odd'),
      undefined,
    );
  });
});
