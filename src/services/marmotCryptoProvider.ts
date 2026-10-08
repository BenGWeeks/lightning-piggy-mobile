// Pure-JS MLS crypto provider for Marmot on Hermes.
//
// marmot-ts (via its vendored ts-mls) ships a "default" provider built on
// WebCrypto (`crypto.subtle`) and a "noble" provider that still routes HPKE
// and AES-GCM through `@hpke/core` → WebCrypto. Hermes has no SubtleCrypto,
// so neither runs on device. This provider implements the ONE ciphersuite
// Marmot uses — MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 (0x0001) —
// entirely on the @noble libraries the app already ships, including HPKE
// base mode per RFC 9180 §4–5.
//
// Keys cross the ts-mls boundary as opaque objects; ts-mls only ever hands
// them back to this provider (import/export/seal/open), so a tagged wrapper
// around the raw 32 bytes stands in for a WebCrypto CryptoKey.

import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { defaultCryptoProvider } from '@internet-privacy/marmot-ts/mls';
import type { CiphersuiteImpl, CryptoProvider } from '@internet-privacy/marmot-ts/mls';

export const MARMOT_CIPHERSUITE_ID = 0x0001;

type Hpke = CiphersuiteImpl['hpke'];
type HpkePublicKey = Parameters<Hpke['exportPublicKey']>[0];
type HpkePrivateKey = Parameters<Hpke['exportPrivateKey']>[0];

interface RawKey {
  type: 'public' | 'private';
  raw: Uint8Array;
}

const wrapPublic = (raw: Uint8Array) =>
  ({ type: 'public', raw: Uint8Array.from(raw) }) as RawKey as unknown as HpkePublicKey;
const wrapPrivate = (raw: Uint8Array) =>
  ({ type: 'private', raw: Uint8Array.from(raw) }) as RawKey as unknown as HpkePrivateKey;
const unwrap = (key: HpkePublicKey | HpkePrivateKey): Uint8Array => {
  const raw = (key as unknown as RawKey).raw;
  if (!(raw instanceof Uint8Array)) throw new Error('marmot crypto: foreign key object');
  return raw;
};

// --- RFC 9180 constants for DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-128-GCM
const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0001;
const N_SECRET = 32;
const N_PK = 32;
const N_K = 16;
const N_N = 12;
const N_H = 32;
const MODE_BASE = 0x00;

const i2osp2 = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const HPKE_V1 = utf8ToBytes('HPKE-v1');
const EMPTY = new Uint8Array(0);
const KEM_SUITE_ID = concatBytes(utf8ToBytes('KEM'), i2osp2(KEM_ID));
const HPKE_SUITE_ID = concatBytes(
  utf8ToBytes('HPKE'),
  i2osp2(KEM_ID),
  i2osp2(KDF_ID),
  i2osp2(AEAD_ID),
);

function labeledExtract(suiteId: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) {
  return extract(sha256, concatBytes(HPKE_V1, suiteId, utf8ToBytes(label), ikm), salt);
}

function labeledExpand(
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) {
  const labeledInfo = concatBytes(i2osp2(length), HPKE_V1, suiteId, utf8ToBytes(label), info);
  return expand(sha256, prk, labeledInfo, length);
}

function dh(sk: Uint8Array, pk: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(sk, pk);
  // RFC 9180 §7.1.4: reject the all-zero output from a low-order point.
  if (shared.every((b) => b === 0)) throw new Error('marmot crypto: invalid X25519 public key');
  return shared;
}

function kemSharedSecret(dhOut: Uint8Array, enc: Uint8Array, pkR: Uint8Array): Uint8Array {
  const eaePrk = labeledExtract(KEM_SUITE_ID, EMPTY, 'eae_prk', dhOut);
  return labeledExpand(KEM_SUITE_ID, eaePrk, 'shared_secret', concatBytes(enc, pkR), N_SECRET);
}

function encap(pkR: Uint8Array): { sharedSecret: Uint8Array; enc: Uint8Array } {
  const skE = x25519.utils.randomSecretKey();
  const enc = x25519.getPublicKey(skE);
  return { sharedSecret: kemSharedSecret(dh(skE, pkR), enc, pkR), enc };
}

function decap(enc: Uint8Array, skR: Uint8Array): Uint8Array {
  if (enc.length !== N_PK) throw new Error('marmot crypto: bad HPKE enc length');
  return kemSharedSecret(dh(skR, enc), enc, x25519.getPublicKey(skR));
}

interface HpkeContext {
  key: Uint8Array;
  baseNonce: Uint8Array;
  exporterSecret: Uint8Array;
}

function keySchedule(sharedSecret: Uint8Array, info: Uint8Array): HpkeContext {
  const pskIdHash = labeledExtract(HPKE_SUITE_ID, EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = labeledExtract(HPKE_SUITE_ID, EMPTY, 'info_hash', info);
  const ksContext = concatBytes(new Uint8Array([MODE_BASE]), pskIdHash, infoHash);
  const secret = labeledExtract(HPKE_SUITE_ID, sharedSecret, 'secret', EMPTY);
  return {
    key: labeledExpand(HPKE_SUITE_ID, secret, 'key', ksContext, N_K),
    // Single-shot seal/open uses sequence number 0, so nonce = base_nonce.
    baseNonce: labeledExpand(HPKE_SUITE_ID, secret, 'base_nonce', ksContext, N_N),
    exporterSecret: labeledExpand(HPKE_SUITE_ID, secret, 'exp', ksContext, N_H),
  };
}

const exportFrom = (ctx: HpkeContext, exporterContext: Uint8Array, length: number) =>
  labeledExpand(HPKE_SUITE_ID, ctx.exporterSecret, 'sec', exporterContext, length);

const aesGcmEncrypt = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, pt: Uint8Array) =>
  gcm(key, nonce, aad.length > 0 ? aad : undefined).encrypt(pt);
const aesGcmDecrypt = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: Uint8Array) =>
  gcm(key, nonce, aad.length > 0 ? aad : undefined).decrypt(ct);

const hpke: Hpke = {
  async seal(publicKey, plaintext, info, aad) {
    const { sharedSecret, enc } = encap(unwrap(publicKey));
    const ctx = keySchedule(sharedSecret, info);
    return { ct: aesGcmEncrypt(ctx.key, ctx.baseNonce, aad ?? EMPTY, plaintext), enc };
  },
  async open(privateKey, kemOutput, ciphertext, info, aad) {
    const ctx = keySchedule(decap(kemOutput, unwrap(privateKey)), info);
    return aesGcmDecrypt(ctx.key, ctx.baseNonce, aad ?? EMPTY, ciphertext);
  },
  async exportSecret(publicKey, exporterContext, length, info) {
    const { sharedSecret, enc } = encap(unwrap(publicKey));
    return { enc, secret: exportFrom(keySchedule(sharedSecret, info), exporterContext, length) };
  },
  async importSecret(privateKey, exporterContext, kemOutput, length, info) {
    const ctx = keySchedule(decap(kemOutput, unwrap(privateKey)), info);
    return exportFrom(ctx, exporterContext, length);
  },
  async importPrivateKey(k) {
    if (k.length !== 32) throw new Error('marmot crypto: X25519 private key must be 32 bytes');
    return wrapPrivate(k);
  },
  async importPublicKey(k) {
    if (k.length !== N_PK) throw new Error('marmot crypto: X25519 public key must be 32 bytes');
    return wrapPublic(k);
  },
  async exportPublicKey(k) {
    return Uint8Array.from(unwrap(k));
  },
  async exportPrivateKey(k) {
    return Uint8Array.from(unwrap(k));
  },
  async encryptAead(key, nonce, aad, plaintext) {
    return aesGcmEncrypt(key, nonce, aad ?? EMPTY, plaintext);
  },
  async decryptAead(key, nonce, aad, ciphertext) {
    return aesGcmDecrypt(key, nonce, aad ?? EMPTY, ciphertext);
  },
  async deriveKeyPair(ikm) {
    // RFC 9180 §7.1.3 DeriveKeyPair for X25519.
    const dkpPrk = labeledExtract(KEM_SUITE_ID, EMPTY, 'dkp_prk', ikm);
    const sk = labeledExpand(KEM_SUITE_ID, dkpPrk, 'sk', EMPTY, 32);
    return { privateKey: wrapPrivate(sk), publicKey: wrapPublic(x25519.getPublicKey(sk)) };
  },
  async generateKeyPair() {
    const sk = x25519.utils.randomSecretKey();
    return { privateKey: wrapPrivate(sk), publicKey: wrapPublic(x25519.getPublicKey(sk)) };
  },
  keyLength: N_K,
  nonceLength: N_N,
};

// ts-mls's WebCrypto path stores Ed25519 sign keys as PKCS#8 (48 bytes);
// the raw seed is the trailing 32 bytes. Accept both so state written by
// either provider stays usable.
const ed25519Seed = (signKey: Uint8Array) =>
  signKey.length === 32 ? signKey : signKey.subarray(signKey.length - 32);

const ciphersuite: CiphersuiteImpl = {
  id: MARMOT_CIPHERSUITE_ID,
  hash: {
    async digest(data) {
      return sha256(data);
    },
    async mac(key, data) {
      return hmac(sha256, key, data);
    },
    async verifyMac(key, mac, data) {
      const expected = hmac(sha256, key, data);
      if (expected.length !== mac.length) return false;
      let diff = 0;
      for (let i = 0; i < mac.length; i++) diff |= expected[i] ^ mac[i];
      return diff === 0;
    },
  },
  kdf: {
    async extract(salt, ikm) {
      return extract(sha256, ikm, salt);
    },
    async expand(prk, info, len) {
      return expand(sha256, prk, info, len);
    },
    size: N_H,
  },
  signature: {
    async sign(signKey, message) {
      return ed25519.sign(message, ed25519Seed(signKey));
    },
    async verify(publicKey, message, signature) {
      try {
        return ed25519.verify(signature, message, publicKey);
      } catch {
        return false;
      }
    },
    async keygen() {
      const signKey = ed25519.utils.randomSecretKey();
      return { signKey, publicKey: ed25519.getPublicKey(signKey) };
    },
  },
  hpke,
  rng: { randomBytes: (n) => randomBytes(n) },
};

export const marmotCryptoProvider: CryptoProvider = {
  async getCiphersuiteImpl(id) {
    if (id !== MARMOT_CIPHERSUITE_ID) {
      throw new Error(`marmot crypto: unsupported MLS ciphersuite 0x${id.toString(16)}`);
    }
    return ciphersuite;
  },
};

/**
 * Several marmot-ts constructors fall back to ts-mls's WebCrypto
 * `defaultCryptoProvider` when no provider is threaded through (e.g.
 * KeyPackageStore, core key-package helpers). Re-point that shared object at
 * ours so no code path can reach `crypto.subtle` on Hermes. Idempotent.
 */
export function installMarmotCryptoProvider(): void {
  defaultCryptoProvider.getCiphersuiteImpl = marmotCryptoProvider.getCiphersuiteImpl;
}
