import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import {
  Movie,
  MovieRequest,
  MovieRequestStatus,
  MovieStatus,
} from '../../entities';
import {
  throwError,
  PaginatedResponse,
  encryptId,
  ICurrentUser,
  ROLES,
  formatUtcDate,
} from '@moviebooking/common';
import { CreateMovieRequestDto } from './dto/create-movie-request.dto';
import { ReviewMovieRequestDto } from './dto/review-movie-request.dto';
import { ListMovieRequestsQueryDto } from './dto/list-movie-requests-query.dto';

@Injectable()
export class MovieRequestsService {
  private readonly logger = new Logger(MovieRequestsService.name);

  constructor(
    @InjectRepository(MovieRequest)
    private readonly movieRequestRepository: Repository<MovieRequest>,
    @InjectRepository(Movie)
    private readonly movieRepository: Repository<Movie>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateMovieRequestDto, user: ICurrentUser) {
    // Theatre Admin must have theatreId in JWT
    if (!user.theatreId) {
      throwError('FORBIDDEN', 'No theatre assignment found');
    }

    // Check for duplicate pending request (same title + theatre)
    const duplicate = await this.movieRequestRepository.findOne({
      where: {
        theatreId: user.theatreId,
        title: dto.title,
        status: MovieRequestStatus.PENDING,
      },
    });

    if (duplicate) {
      throwError(
        'DUPLICATE_RESOURCE',
        `A pending request for "${dto.title}" already exists for your theatre`,
      );
    }

    const request = this.movieRequestRepository.create({
      ...dto,
      releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
      expectedReleaseDate: dto.expectedReleaseDate
        ? new Date(dto.expectedReleaseDate)
        : null,
      theatreId: user.theatreId,
      requestedByUserId: user.id,
      status: MovieRequestStatus.PENDING,
    });

    const saved = await this.movieRequestRepository.save(request);
    this.logger.log(
      `Movie request created: "${saved.title}" by user ${user.id}`,
    );
    return this.mapResponse(saved);
  }

  async findAll(query: ListMovieRequestsQueryDto, user: ICurrentUser) {
    const { page = 1, pageSize = 20, status, theatreId } = query;
    const isTheatreAdmin = user.role?.code === ROLES.THEATRE_ADMIN;

    const qb = this.movieRequestRepository.createQueryBuilder('req');

    // Theatre Admin: own requests only
    if (isTheatreAdmin) {
      qb.where('req.theatreId = :theatreId', { theatreId: user.theatreId });
    } else if (theatreId) {
      qb.where('req.theatreId = :theatreId', { theatreId });
    }

    if (status) {
      qb.andWhere('req.status = :status', { status });
    }

    qb.orderBy('req.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [requests, total] = await qb.getManyAndCount();

    return new PaginatedResponse(
      requests.map((r) => this.mapResponse(r)),
      total,
      page,
      pageSize,
    );
  }

  async findOne(id: number, user: ICurrentUser) {
    const request = await this.movieRequestRepository.findOne({
      where: { id },
      relations: ['createdMovie'],
    });

    if (!request) {
      throwError('NOT_FOUND', 'Movie request not found');
    }

    // Theatre Admin can only see own requests
    if (
      user.role?.code === ROLES.THEATRE_ADMIN &&
      request.theatreId !== user.theatreId
    ) {
      throwError('NOT_FOUND', 'Movie request not found');
    }

    return this.mapDetailResponse(request);
  }

  async approve(id: number, dto: ReviewMovieRequestDto, user: ICurrentUser) {
    // Lock, re-check and write in one transaction: creating the movie and
    // marking the request APPROVED either both happen or neither does.
    const { savedRequest, savedMovie } = await this.dataSource.transaction(
      async (manager) => {
        const request = await this.lockPendingRequest(manager, id, 'approved');

        const savedMovie = await manager.save(
          Movie,
          manager.create(Movie, {
            title: request.title,
            description: request.description,
            releaseDate:
              request.releaseDate ?? request.expectedReleaseDate ?? new Date(),
            cast: request.cast,
            director: request.director,
            language: request.language,
            status: MovieStatus.ACTIVE,
          }),
        );

        request.status = MovieRequestStatus.APPROVED;
        request.reviewedByUserId = user.id;
        request.reviewedAt = new Date();
        request.reviewReason = dto.reviewReason;
        request.createdMovieId = savedMovie.id;

        const savedRequest = await manager.save(MovieRequest, request);
        return { savedRequest, savedMovie };
      },
    );

    this.logger.log(
      `Movie request ${id} approved, movie created: ${savedMovie.id}`,
    );
    return this.mapDetailResponse({
      ...savedRequest,
      createdMovie: savedMovie,
    });
  }

  async reject(id: number, dto: ReviewMovieRequestDto, user: ICurrentUser) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const request = await this.lockPendingRequest(manager, id, 'rejected');

      request.status = MovieRequestStatus.REJECTED;
      request.reviewedByUserId = user.id;
      request.reviewedAt = new Date();
      request.reviewReason = dto.reviewReason;

      return manager.save(MovieRequest, request);
    });

    this.logger.log(`Movie request ${id} rejected by user ${user.id}`);
    return this.mapResponse(saved);
  }

  /**
   * Reads the request with an exclusive row lock and checks it is still PENDING.
   * A second reviewer acting at the same time waits on the lock, then sees the
   * first reviewer's decision and gets 422, so a request is never decided twice
   * (and never creates two movies).
   */
  private async lockPendingRequest(
    manager: EntityManager,
    id: number,
    action: 'approved' | 'rejected',
  ): Promise<MovieRequest> {
    const request = await manager.findOne(MovieRequest, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!request) {
      throwError('NOT_FOUND', 'Movie request not found');
    }

    if (request.status !== MovieRequestStatus.PENDING) {
      throwError(
        'BUSINESS_RULE_VIOLATION',
        `Only PENDING requests can be ${action}`,
      );
    }

    return request;
  }

  private mapResponse(request: MovieRequest) {
    return {
      id: encryptId(request.id),
      theatreId: encryptId(request.theatreId),
      requestedByUserId: encryptId(request.requestedByUserId),
      title: request.title,
      description: request.description,
      releaseDate: formatUtcDate(request.releaseDate),
      cast: request.cast,
      director: request.director,
      language: request.language,
      expectedReleaseDate: formatUtcDate(request.expectedReleaseDate),
      notes: request.notes,
      status: request.status,
      reviewedByUserId: request.reviewedByUserId
        ? encryptId(request.reviewedByUserId)
        : null,
      reviewedAt: request.reviewedAt,
      reviewReason: request.reviewReason,
      createdMovieId: request.createdMovieId
        ? encryptId(request.createdMovieId)
        : null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private mapDetailResponse(request: MovieRequest) {
    return {
      ...this.mapResponse(request),
      createdMovie: request.createdMovie
        ? {
            id: encryptId(request.createdMovie.id),
            title: request.createdMovie.title,
          }
        : null,
    };
  }
}
