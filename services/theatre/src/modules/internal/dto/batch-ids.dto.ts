import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

/** Largest batch accepted by an internal lookup; list pages are capped at 100. */
export const MAX_BATCH_IDS = 500;

/** Body of the internal batch lookup: a list of positive integer theatre IDs. */
export class TheatreIdsDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_IDS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  theatreIds: number[];
}

/** Body of the internal batch lookup: a list of positive integer screen IDs. */
export class ScreenIdsDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_IDS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  screenIds: number[];
}
