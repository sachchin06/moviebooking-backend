/**
 * Throws at start-up when any of the named environment variables is missing or empty,
 * so a misconfigured service stops immediately instead of failing on its first request.
 */
export function assertRequiredEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }
}
