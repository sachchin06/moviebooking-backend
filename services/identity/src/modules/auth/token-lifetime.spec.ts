import { parseDurationToSeconds } from './token-lifetime';

describe('parseDurationToSeconds', () => {
  it.each([
    ['3600', 3600],
    ['45s', 45],
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604800],
    [' 2h ', 7200],
  ])('reads "%s" as %i seconds', (value, seconds) => {
    expect(parseDurationToSeconds('JWT_EXPIRES_IN', value)).toBe(seconds);
  });

  it.each(['', '0', '1w', 'one hour', '-5m', '1.5h'])(
    'rejects "%s"',
    (value) => {
      expect(() => parseDurationToSeconds('JWT_EXPIRES_IN', value)).toThrow(
        'JWT_EXPIRES_IN must be',
      );
    },
  );
});
