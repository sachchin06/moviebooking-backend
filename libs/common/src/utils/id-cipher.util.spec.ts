type IdCipher = typeof import('./id-cipher.util');

/**
 * The cipher keeps its key in module state, so each test loads a fresh copy of the
 * module to choose between "encryption enabled" and "disabled".
 */
function loadCipher(key?: string): IdCipher {
  let cipher!: IdCipher;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cipher = require('./id-cipher.util');
  });
  if (key) {
    cipher.initIdCipher(key);
  }
  return cipher;
}

describe('id-cipher with encryption enabled', () => {
  const cipher = loadCipher('test-encryption-key');

  it('round-trips an ID', () => {
    const encrypted = cipher.encryptId(4321);
    expect(encrypted).not.toBe('4321');
    expect(cipher.decryptId(encrypted)).toBe(4321);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(cipher.encryptId(7)).not.toBe(cipher.encryptId(7));
  });

  it('rejects a tampered value', () => {
    const encrypted = cipher.encryptId(42);
    const bytes = Buffer.from(encrypted, 'base64url');
    bytes[bytes.length - 1] ^= 0x01; // flip one bit of the ciphertext
    expect(cipher.decryptId(bytes.toString('base64url'))).toBeNull();
  });

  it.each(['5', '42', '0'])('rejects the plain integer "%s"', (plain) => {
    expect(cipher.decryptId(plain)).toBeNull();
  });

  it.each(['', 'not-an-id', '!!!'])(
    'rejects the garbage value "%s"',
    (value) => {
      expect(cipher.decryptId(value)).toBeNull();
    },
  );

  it('rejects a value encrypted with a different key', () => {
    const other = loadCipher('another-key');
    expect(cipher.decryptId(other.encryptId(42))).toBeNull();
  });
});

describe('id-cipher with encryption disabled', () => {
  const cipher = loadCipher();

  it('passes plain digit strings through', () => {
    expect(cipher.isIdCipherEnabled()).toBe(false);
    expect(cipher.encryptId(12)).toBe('12');
    expect(cipher.decryptId('12')).toBe(12);
  });

  it.each(['12abc', '-1', '1.5', 'abc', ''])('rejects "%s"', (value) => {
    expect(cipher.decryptId(value)).toBeNull();
  });
});
