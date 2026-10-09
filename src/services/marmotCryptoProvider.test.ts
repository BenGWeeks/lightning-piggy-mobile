import { defaultCryptoProvider } from '@internet-privacy/marmot-ts/mls';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { MARMOT_CIPHERSUITE_ID, marmotCryptoProvider } from './marmotCryptoProvider';

// The reference is ts-mls's WebCrypto provider, which runs under Node (which
// HAS crypto.subtle) but not Hermes. Byte-for-byte agreement in both
// directions proves our pure-JS HPKE/KDF/AEAD/signature match it.
const getSuites = async () => ({
  ours: await marmotCryptoProvider.getCiphersuiteImpl(MARMOT_CIPHERSUITE_ID),
  ref: await defaultCryptoProvider.getCiphersuiteImpl(MARMOT_CIPHERSUITE_ID),
});

const info = utf8ToBytes('marmot test info');
const aad = utf8ToBytes('marmot test aad');
const plaintext = utf8ToBytes('oink oink — a secret for the piggy');

describe('marmotCryptoProvider', () => {
  it('rejects ciphersuites other than 0x0001', async () => {
    await expect(marmotCryptoProvider.getCiphersuiteImpl(2)).rejects.toThrow(/unsupported/);
  });

  it('derives the same HPKE key pair as the reference', async () => {
    const { ours, ref } = await getSuites();
    const ikm = utf8ToBytes('deterministic input keying material!');
    const a = await ours.hpke.deriveKeyPair(ikm);
    const b = await ref.hpke.deriveKeyPair(ikm);
    expect(await ours.hpke.exportPublicKey(a.publicKey)).toEqual(
      await ref.hpke.exportPublicKey(b.publicKey),
    );
    expect(await ours.hpke.exportPrivateKey(a.privateKey)).toEqual(
      await ref.hpke.exportPrivateKey(b.privateKey),
    );
  });

  it.each([
    ['ours → ref', 'ours', 'ref'],
    ['ref → ours', 'ref', 'ours'],
  ] as const)('HPKE seal/open interoperates (%s)', async (_label, sealer, opener) => {
    const suites = await getSuites();
    const recipient = await suites[opener].hpke.generateKeyPair();
    const pkBytes = await suites[opener].hpke.exportPublicKey(recipient.publicKey);

    const pk = await suites[sealer].hpke.importPublicKey(pkBytes);
    const { ct, enc } = await suites[sealer].hpke.seal(pk, plaintext, info, aad);
    const opened = await suites[opener].hpke.open(recipient.privateKey, enc, ct, info, aad);
    expect(opened).toEqual(plaintext);
  });

  it.each([
    ['ours → ref', 'ours', 'ref'],
    ['ref → ours', 'ref', 'ours'],
  ] as const)('HPKE exporter secrets agree (%s)', async (_label, sender, receiver) => {
    const suites = await getSuites();
    const recipient = await suites[receiver].hpke.generateKeyPair();
    const pk = await suites[sender].hpke.importPublicKey(
      await suites[receiver].hpke.exportPublicKey(recipient.publicKey),
    );
    const ctxBytes = utf8ToBytes('exporter context');
    const sent = await suites[sender].hpke.exportSecret(pk, ctxBytes, 32, info);
    const received = await suites[receiver].hpke.importSecret(
      recipient.privateKey,
      ctxBytes,
      sent.enc,
      32,
      info,
    );
    expect(received).toEqual(sent.secret);
  });

  it('fails to open a tampered ciphertext', async () => {
    const { ours } = await getSuites();
    const kp = await ours.hpke.generateKeyPair();
    const { ct, enc } = await ours.hpke.seal(kp.publicKey, plaintext, info, aad);
    ct[0] ^= 0x01;
    await expect(ours.hpke.open(kp.privateKey, enc, ct, info, aad)).rejects.toThrow();
  });

  it('AEAD, hash, MAC and KDF match the reference', async () => {
    const { ours, ref } = await getSuites();
    const key = ours.rng.randomBytes(16);
    const nonce = ours.rng.randomBytes(12);
    for (const a of [aad, undefined]) {
      const ct = await ours.hpke.encryptAead(key, nonce, a, plaintext);
      expect(await ref.hpke.encryptAead(key, nonce, a, plaintext)).toEqual(ct);
      expect(await ours.hpke.decryptAead(key, nonce, a, ct)).toEqual(plaintext);
    }

    expect(await ours.hash.digest(plaintext)).toEqual(await ref.hash.digest(plaintext));
    const mac = await ours.hash.mac(key, plaintext);
    expect(mac).toEqual(await ref.hash.mac(key, plaintext));
    expect(await ours.hash.verifyMac(key, mac, plaintext)).toBe(true);
    expect(await ours.hash.verifyMac(key, mac.slice(1), plaintext)).toBe(false);

    // MLS always extracts with an Nh-sized salt; the reference enforces it.
    const salt = ours.rng.randomBytes(32);
    const prk = await ours.kdf.extract(salt, plaintext);
    expect(prk).toEqual(await ref.kdf.extract(salt, plaintext));
    expect(await ours.kdf.expand(prk, info, 42)).toEqual(await ref.kdf.expand(prk, info, 42));
    expect(ours.kdf.size).toBe(ref.kdf.size);
  });

  it('Ed25519 signatures interoperate, including PKCS#8 sign keys', async () => {
    const { ours, ref } = await getSuites();
    const mine = await ours.signature.keygen();
    const sig = await ours.signature.sign(mine.signKey, plaintext);
    expect(await ref.signature.verify(mine.publicKey, plaintext, sig)).toBe(true);

    // The WebCrypto reference emits PKCS#8 sign keys.
    const theirs = await ref.signature.keygen();
    const sig2 = await ours.signature.sign(theirs.signKey, plaintext);
    expect(await ours.signature.verify(theirs.publicKey, plaintext, sig2)).toBe(true);
    expect(await ours.signature.verify(theirs.publicKey, info, sig2)).toBe(false);
  });
});
