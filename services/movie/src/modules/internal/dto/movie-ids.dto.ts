import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

/** Largest batch accepted by an internal lookup; list pages are capped at 100. */
export const MAX_BATCH_IDS = 500;

/** Body of the internal batch lookup: a list of positive integer movie IDs. */
export class MovieIdsDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_IDS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  movieIds: number[];
}
