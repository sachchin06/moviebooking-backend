import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeController } from '@nestjs/swagger';
import { SkipTransform, InternalApiGuard } from '@moviebooking/common';
import { InternalService } from './internal.service';
import { MovieIdsDto } from './dto/movie-ids.dto';

/** Internal endpoints for service-to-service calls. Callers must send X-Internal-Key. */
@ApiExcludeController()
@ApiTags('internal')
@SkipTransform()
@UseGuards(InternalApiGuard)
@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @Get('movies/:id')
  @ApiOperation({ summary: 'Get movie by ID (internal)' })
  async getMovieById(@Param('id', ParseIntPipe) id: number) {
    return this.internalService.getMovieById(id);
  }

  @Post('movies/batch')
  @ApiOperation({ summary: 'Get multiple movies by IDs (internal)' })
  async getMoviesByIds(@Body() body: MovieIdsDto) {
    return this.internalService.getMoviesByIds(body.movieIds);
  }
}
