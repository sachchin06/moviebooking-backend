import { randomInt } from 'crypto';

/**
 * Random values here use crypto.randomInt (a cryptographically secure generator).
 * Math.random is predictable: its output can be reconstructed from a few samples,
 * which would make booking references and temporary passwords guessable.
 */

/** Picks one character from the alphabet with a uniform, unpredictable choice. */
function pick(alphabet: string): string {
  return alphabet.charAt(randomInt(alphabet.length));
}

// Booking reference alphabet: no 0/O or I, which are easily confused when read aloud.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Random identifier of the given length, e.g. a booking reference. */
export function generateId(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += pick(ALPHABET);
  }
  return result;
}

// Temporary password generator
const PASSWORD_CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SPECIAL_CHARS = '@#$%&*';
const DIGITS = '0123456789';

/** Temporary password: "Temp@" + 8 random characters + 1 special character + 1 digit. */
export function generateTempPassword(): string {
  let password = 'Temp@';
  for (let i = 0; i < 8; i++) {
    password += pick(PASSWORD_CHARS);
  }
  // Add a special character and a digit so it meets complexity rules.
  password += pick(SPECIAL_CHARS);
  password += pick(DIGITS);
  return password;
}
