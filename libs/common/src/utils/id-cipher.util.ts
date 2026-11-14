import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const logger = new Logger('IdCipher');

let encryptionKey: Buffer | null = null;

/**
 * Initialize the cipher with encryption key from environment
 * Call this once at app startup
 */
export function initIdCipher(key?: string): void {
  const secretKey = key || process.env.ID_ENCRYPTION_KEY || '';
  if (!secretKey) {
    logger.warn('ID_ENCRYPTION_KEY not set - ID encryption disabled');
    return;
  }
  // Create 32-byte key from secret using SHA-256
  encryptionKey = crypto.createHash('sha256').update(secretKey).digest();
}

/**
 * Encrypt a numeric ID to an obfuscated string
 * Returns original ID as string if encryption not initialized
 */
export function encryptId(id: number): string {
  if (!encryptionKey) {
    return String(id);
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const idBuffer = Buffer.from(String(id), 'utf8');
    const encrypted = Buffer.concat([cipher.update(idBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Combine: iv + authTag + encrypted, then base64url encode
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64url');
  } catch {
    return String(id);
  }
}

/**
 * Decrypts an obfuscated string back to a numeric ID. Returns null when it fails.
 *
 * With encryption enabled, only a genuine ciphertext produced by encryptId() is
 * accepted: a plain number such as "5" is rejected, otherwise anyone could bypass the
 * obfuscation and enumerate records by counting.
 * With encryption disabled (no ID_ENCRYPTION_KEY, e.g. in tests), the value must be a
 * plain string of digits.
 */
export function decryptId(encryptedId: string): number | null {
  if (!encryptionKey) {
    return parseDigits(encryptedId);
  }

  try {
    const combined = Buffer.from(encryptedId, 'base64url');

    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      return null;
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    // final() throws if the auth tag does not match (tampered or foreign value).
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return parseDigits(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

/** Parses a string made only of digits; anything else (e.g. "12abc") gives null. */
function parseDigits(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) {
    return null;
  }
  return Number(value);
}

/**
 * Check if ID cipher is initialized
 */
export function isIdCipherEnabled(): boolean {
  return encryptionKey !== null;
}
