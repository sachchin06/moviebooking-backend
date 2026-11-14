import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { BaseServiceClient } from '@moviebooking/common';

interface TheatreAdminResponse {
  theatreId: number | null;
}

@Injectable()
export class TheatreClient extends BaseServiceClient {
  constructor(httpService: HttpService) {
    super(httpService, 'TheatreClient');
  }

  /**
   * Get the assigned theatreId for a user from Theatre Service.
   * Returns null if the user has no assignment; throws SERVICE_UNAVAILABLE if the
   * Theatre Service cannot be reached.
   */
  async getTheatreIdByUserId(userId: number): Promise<number | null> {
    const result = await this.get<TheatreAdminResponse>(
      `/api/internal/theatre-admins/by-user/${userId}`,
    );
    return result?.theatreId ?? null;
  }
}
