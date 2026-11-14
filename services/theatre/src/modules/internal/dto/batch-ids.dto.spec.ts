import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_BATCH_IDS, ScreenIdsDto, TheatreIdsDto } from './batch-ids.dto';

async function errorsFor(cls: new () => object, body: unknown) {
  const errors = await validate(plainToInstance(cls, body) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length;
}

describe('internal batch DTOs', () => {
  it.each([
    ['a list of positive integers', { screenIds: [1, 2, 3] }],
    ['an empty list', { screenIds: [] }],
  ])('accepts %s', async (_label, body) => {
    expect(await errorsFor(ScreenIdsDto, body)).toBe(0);
  });

  it.each([
    ['a missing field', {}],
    ['a non-array', { screenIds: '1,2' }],
    ['strings', { screenIds: ['1'] }],
    ['zero', { screenIds: [0] }],
    ['decimals', { screenIds: [1.5] }],
    [
      'too many IDs',
      { screenIds: Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => i + 1) },
    ],
    ['unknown properties', { screenIds: [1], extra: true }],
  ])('rejects %s', async (_label, body) => {
    expect(await errorsFor(ScreenIdsDto, body)).toBeGreaterThan(0);
  });

  it('applies the same rules to theatreIds', async () => {
    expect(await errorsFor(TheatreIdsDto, { theatreIds: [4] })).toBe(0);
    expect(
      await errorsFor(TheatreIdsDto, { theatreIds: [-4] }),
    ).toBeGreaterThan(0);
  });
});
