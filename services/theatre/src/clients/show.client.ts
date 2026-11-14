import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AppException, BaseServiceClient } from '@moviebooking/common';

/** Client for the Show Service internal APIs. */
@Injectable()
export class ShowClient extends BaseServiceClient {
  constructor(httpService: HttpService) {
    super(httpService, 'ShowClient');
  }

  /**
   * True when any of the screens has an ACTIVE show that has not started yet.
   * Throws SERVICE_UNAVAILABLE when the Show Service cannot give a clear answer, so
   * a screen or theatre is never deactivated on an unknown answer.
   */
  async hasFutureShows(screenIds: number[]): Promise<boolean> {
    if (screenIds.length === 0) {
      return false;
    }
    const result = await this.get<{ exists: boolean }>(
      `/api/internal/shows/exists-future?screenIds=${screenIds.join(',')}`,
    );
    // A 404 here means the endpoint is missing, not "no shows".
    if (result === null || typeof result.exists !== 'boolean') {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Could not confirm whether the screens have future shows',
      );
    }
    return result.exists;
  }
}
