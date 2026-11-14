import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { AppException } from '../exceptions/app.exception';
import { BaseServiceClient } from './base-service.client';

/** Concrete client exposing the protected helpers for testing. */
class TestClient extends BaseServiceClient {
  constructor(httpService: HttpService) {
    super(httpService, 'TestClient');
  }
  fetch(path: string) {
    return this.get<{ id: number }>(path);
  }
  send(path: string, body: object) {
    return this.post<{ id: number }[]>(path, body);
  }
}

function axiosErrorWithStatus(status: number): AxiosError {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = { status } as AxiosResponse;
  return error;
}

function build(result: 'ok' | number | 'network') {
  const respond = () =>
    result === 'ok'
      ? of({ data: { id: 1 } } as AxiosResponse)
      : throwError(() =>
          result === 'network'
            ? new AxiosError('connect ECONNREFUSED 127.0.0.1:3002')
            : axiosErrorWithStatus(result),
        );
  const httpService = {
    get: jest.fn(respond),
    post: jest.fn(respond),
  } as unknown as HttpService;
  return { client: new TestClient(httpService), httpService };
}

async function statusOfRejection(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(
    () => {
      throw new Error('Expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  return (error as AppException).getStatus();
}

describe('BaseServiceClient error mapping', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the response body on success', async () => {
    const { client } = build('ok');
    await expect(client.fetch('/api/internal/things/1')).resolves.toEqual({
      id: 1,
    });
  });

  it('returns null on 404 (the resource does not exist)', async () => {
    const { client } = build(404);
    await expect(client.fetch('/api/internal/things/1')).resolves.toBeNull();
    await expect(
      client.send('/api/internal/things/batch', {}),
    ).resolves.toBeNull();
  });

  it.each([500, 503, 401, 400])(
    'throws SERVICE_UNAVAILABLE (503) when the other service answers %i',
    async (status) => {
      const { client } = build(status);
      expect(
        await statusOfRejection(client.fetch('/api/internal/things/1')),
      ).toBe(503);
    },
  );

  it('throws SERVICE_UNAVAILABLE (503) when the other service cannot be reached', async () => {
    const { client } = build('network');
    expect(
      await statusOfRejection(
        client.send('/api/internal/things/batch', { ids: [1] }),
      ),
    ).toBe(503);
  });

  it('sends POST bodies unchanged', async () => {
    const { client, httpService } = build('ok');
    await client.send('/api/internal/things/batch', { ids: [1, 2] });
    expect(httpService.post).toHaveBeenCalledWith(
      '/api/internal/things/batch',
      {
        ids: [1, 2],
      },
    );
  });
});
