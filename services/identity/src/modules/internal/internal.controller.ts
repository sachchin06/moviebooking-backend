import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeController } from '@nestjs/swagger';
import { SkipTransform, InternalApiGuard } from '@moviebooking/common';
import { InternalService } from './internal.service';
import { UserIdsDto } from './dto/user-ids.dto';

@ApiExcludeController()
@ApiTags('internal')
@SkipTransform()
@UseGuards(InternalApiGuard)
@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID (internal)' })
  async getUserById(@Param('id', ParseIntPipe) id: number) {
    return this.internalService.getUserById(id);
  }

  @Post('users/batch')
  @ApiOperation({ summary: 'Get users by IDs (internal)' })
  async getUsersByIds(@Body() body: UserIdsDto) {
    return this.internalService.getUsersByIds(body.userIds);
  }
}
