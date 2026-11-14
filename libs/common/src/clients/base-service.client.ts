import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { AppException } from '../exceptions/app.exception';

/**
 * Base class for service-to-service HTTP clients. One error rule for every service:
 * - 404 from the other service is a real answer ("does not exist") → returns null
 * - anything else (timeout, connection refused, 5xx, 401, ...) → throws
 *   SERVICE_UNAVAILABLE (503)
 *
 * Callers can therefore trust a null, and never act on half-known data because an
 * outage was mistaken for "not found".
 */
@Injectable()
export abstract class BaseServiceClient {
  protected readonly logger: Logger;

  constructor(
    protected readonly httpService: HttpService,
    serviceName: string,
  ) {
    this.logger = new Logger(serviceName);
  }

  /** GET: the response body, null on 404, SERVICE_UNAVAILABLE on any other failure. */
  protected get<T>(path: string): Promise<T | null> {
    return this.request<T>('get', path);
  }

  /** POST: the response body, null on 404, SERVICE_UNAVAILABLE on any other failure. */
  protected post<T>(path: string, body: object): Promise<T | null> {
    return this.request<T>('post', path, body);
  }

  private async request<T>(
    method: 'get' | 'post',
    path: string,
    body?: object,
  ): Promise<T | null> {
    try {
      const response =
        method === 'get'
          ? await firstValueFrom(this.httpService.get<T>(path))
          : await firstValueFrom(this.httpService.post<T>(path, body ?? {}));
      return response.data;
    } catch (error) {
      const status = (error as AxiosError).response?.status;

      if (status === 404) {
        return null;
      }

      this.logger.warn(
        `${method.toUpperCase()} ${path} failed${status ? ` with ${status}` : ''}: ${(error as Error).message}`,
      );
      throw new AppException('SERVICE_UNAVAILABLE');
    }
  }
}
