import { Repository } from 'typeorm';
import { Movie, MovieImage } from '../../entities';
import { MovieImagesService } from './movie-images.service';
import { expectAppError } from '../../testing/test-helpers';

interface StoredImage {
  id: number;
  movieId: number;
  imageUrl: string;
  isPrimary: boolean;
}

/**
 * In-memory image table. manager.update applies its criteria like SQL would, so
 * the tests check the real outcome: how many primary images a movie ends up with.
 */
function build(initial: StoredImage[]) {
  const images = initial.map((i) => ({ ...i }));
  let nextId = 100;

  const matches = (image: StoredImage, criteria: Partial<StoredImage>) =>
    Object.entries(criteria).every(
      ([key, value]) => image[key as keyof StoredImage] === value,
    );

  const manager = {
    update: jest.fn(
      async (
        _e: unknown,
        criteria: Partial<StoredImage>,
        changes: Partial<StoredImage>,
      ) => {
        images
          .filter((i) => matches(i, criteria))
          .forEach((i) => Object.assign(i, changes));
      },
    ),
    create: jest.fn((_e: unknown, data: Omit<StoredImage, 'id'>) => ({
      ...data,
    })),
    save: jest.fn(async (image: StoredImage) => {
      const found = images.find((i) => i.id === image.id);
      if (found) {
        Object.assign(found, image);
        return found;
      }
      const created = { ...image, id: nextId++ };
      images.push(created);
      return created;
    }),
  };
  const queryRunner = {
    manager,
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  };
  const movieImageRepository = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) => {
      const found = images.find((i) => i.id === where.id);
      return found ? { ...found } : null;
    }),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn(async (image: StoredImage) => manager.save(image)),
  };
  const movieRepository = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
      where.id === 1 ? { id: 1 } : null,
    ),
  };
  const service = new MovieImagesService(
    movieRepository as unknown as Repository<Movie>,
    movieImageRepository as unknown as Repository<MovieImage>,
    { createQueryRunner: () => queryRunner } as never,
  );
  const primaries = (movieId = 1) =>
    images.filter((i) => i.movieId === movieId && i.isPrimary);
  return { service, images, primaries, queryRunner };
}

const poster = (id: number, isPrimary: boolean, movieId = 1): StoredImage => ({
  id,
  movieId,
  imageUrl: `https://cdn.example.com/${id}.jpg`,
  isPrimary,
});

describe('MovieImagesService primary image swap', () => {
  it('adding a new primary image leaves exactly one primary (the new one)', async () => {
    const { service, primaries, queryRunner } = build([
      poster(1, true),
      poster(2, false),
    ]);

    const result = await service.create(1, {
      imageUrl: 'https://cdn.example.com/new.jpg',
      isPrimary: true,
    });

    expect(primaries()).toHaveLength(1);
    expect(primaries()[0].imageUrl).toBe('https://cdn.example.com/new.jpg');
    expect(result.isPrimary).toBe(true);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('promoting an existing image leaves exactly one primary (the promoted one)', async () => {
    const { service, primaries } = build([poster(1, true), poster(2, false)]);

    await service.update(2, { isPrimary: true });

    expect(primaries().map((i) => i.id)).toEqual([2]);
  });

  it('does not touch other movies’ primary images', async () => {
    const { service, primaries } = build([poster(1, true), poster(3, true, 2)]);

    await service.create(1, {
      imageUrl: 'https://cdn.example.com/x.jpg',
      isPrimary: true,
    });

    expect(primaries(2).map((i) => i.id)).toEqual([3]);
  });

  it('adding a non-primary image keeps the existing primary', async () => {
    const { service, primaries } = build([poster(1, true)]);
    await service.create(1, {
      imageUrl: 'https://cdn.example.com/y.jpg',
      isPrimary: false,
    });
    expect(primaries().map((i) => i.id)).toEqual([1]);
  });

  it('rolls back the swap if saving the new primary fails', async () => {
    const { service, queryRunner } = build([poster(1, true)]);
    (queryRunner.manager.save as jest.Mock).mockRejectedValueOnce(
      new Error('db'),
    );

    await expect(
      service.create(1, {
        imageUrl: 'https://cdn.example.com/z.jpg',
        isPrimary: true,
      }),
    ).rejects.toThrow('db');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown movie', async () => {
    const { service } = build([]);
    await expectAppError(
      service.create(9, {
        imageUrl: 'https://cdn.example.com/a.jpg',
        isPrimary: true,
      }),
      404,
    );
  });
});
