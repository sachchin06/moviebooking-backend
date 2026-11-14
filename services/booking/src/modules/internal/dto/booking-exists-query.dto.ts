import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class BookingExistsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  showId: number;
}
