const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Converts a JWT lifetime setting ("3600", "15m", "1h", "7d") to seconds.
 * The same number is used to sign the token and to report expiresIn, so the two can
 * never disagree. An unsupported value stops start-up instead of failing at login.
 */
export function parseDurationToSeconds(name: string, value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  const seconds = match
    ? Number(match[1]) * UNIT_SECONDS[match[2] ?? 's']
    : Number.NaN;

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(
      `${name} must be a positive number of seconds or use s/m/h/d (e.g. 15m, 1h, 7d); got "${value}"`,
    );
  }
  return seconds;
}
