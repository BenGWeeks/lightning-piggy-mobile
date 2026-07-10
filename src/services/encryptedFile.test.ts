import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { encryptFile, decryptFile, KEY_BYTES, NONCE_BYTES } from './encryptedFile';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('encryptedFile (AES-256-GCM, NIP-17 kind-15)', () => {
  it('round-trips plaintext', () => {
    const msg = 'hello pig 🐷 voice note bytes';
    const { ciphertext, keyHex, nonceHex } = encryptFile(enc.encode(msg));
    expect(dec.decode(decryptFile(ciphertext, keyHex, nonceHex))).toBe(msg);
  });

  it('uses a 32-byte key (64 hex) and 12-byte nonce (24 hex)', () => {
    const { keyHex, nonceHex } = encryptFile(enc.encode('x'));
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(nonceHex).toMatch(/^[0-9a-f]{24}$/);
    expect(KEY_BYTES).toBe(32);
    expect(NONCE_BYTES).toBe(12);
  });

  it('appends the 16-byte GCM tag and never emits plaintext', () => {
    const plain = enc.encode('the quick brown fox');
    const { ciphertext } = encryptFile(plain);
    expect(ciphertext.length).toBe(plain.length + 16);
    expect(Buffer.from(ciphertext).equals(Buffer.from(plain))).toBe(false);
  });

  it('reports sha256 of the ciphertext (Blossom address / NIP-17 `x`)', () => {
    const { ciphertext, sha256Hex } = encryptFile(enc.encode('addr'));
    expect(sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex).toBe(bytesToHex(sha256(ciphertext)));
  });

  it('generates a fresh key + nonce every call', () => {
    const a = encryptFile(enc.encode('same'));
    const b = encryptFile(enc.encode('same'));
    expect(a.keyHex).not.toBe(b.keyHex);
    expect(a.nonceHex).not.toBe(b.nonceHex);
  });

  it('rejects tampered ciphertext (GCM auth fails)', () => {
    const { ciphertext, keyHex, nonceHex } = encryptFile(enc.encode('integrity'));
    const tampered = Uint8Array.from(ciphertext);
    tampered[0] ^= 0xff;
    expect(() => decryptFile(tampered, keyHex, nonceHex)).toThrow();
  });

  it('rejects the wrong key', () => {
    const { ciphertext, nonceHex } = encryptFile(enc.encode('secret'));
    expect(() => decryptFile(ciphertext, '00'.repeat(32), nonceHex)).toThrow();
  });

  it('rejects malformed key/nonce lengths', () => {
    const { ciphertext, keyHex, nonceHex } = encryptFile(enc.encode('z'));
    expect(() => decryptFile(ciphertext, 'ab', nonceHex)).toThrow(/key length/i);
    expect(() => decryptFile(ciphertext, keyHex, 'ab')).toThrow(/nonce length/i);
  });
});
