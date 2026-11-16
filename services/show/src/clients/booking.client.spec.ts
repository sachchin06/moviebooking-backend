import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { BookingClient } from './booking.client';
import { expectAppError } from '../testing/test-helpers';

function clientRespondingWith(response: 'error500' | 'error404' | unknown) {
  const get = jest.fn(() => {
    if (response === 'error500' || response === 'error404') {
      const error = new AxiosError('failed');
      error.response = {
        status: response === 'error404' ? 404 : 500,
      } as AxiosResponse;
      return throwError(() => error);
    }
    return of({ data: response } as AxiosResponse);
  });
  return { client: new BookingClient({ get } as unknown as HttpService), get };
}

describe('BookingClient.hasLiveBookings', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it.each([true, false])('returns %s as reported', async (exists) => {
    const { client, get } = clientRespondingWith({ exists });
    await expect(client.hasLiveBookings(4)).resolves.toBe(exists);
    expect(get).toHaveBeenCalledWith('/api/internal/bookings/exists?showId=4');
  });

  it.each([
    ['the service fails', 'error500'],
    ['the endpoint is missing (404)', 'error404'],
    ['the answer is malformed', { exists: 'yes' }],
  ])('throws 503 when %s', async (_label, response) => {
    const { client } = clientRespondingWith(response);
    await expectAppError(client.hasLiveBookings(4), 503);
  });
});
