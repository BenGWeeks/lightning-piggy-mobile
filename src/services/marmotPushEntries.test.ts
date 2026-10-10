import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools';

import {
  applyPushPayload,
  leafKey,
  ownerProofEvent,
  parsePushPayload,
  verifyOwnerSig,
  type PushRecord,
} from './marmotPush';
import {
  buildOwnRecord,
  OwnerProofMismatch,
  ownerSigFromSigned,
  removalFor,
  signEntry,
  tokenRemovalEvent,
  tokenUpdateEvent,
  type DeviceRegistration,
  type Sign,
} from './marmotPushEntries';
import { tokenFingerprint } from './marmotPushToken';

const SERVER = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(0x44)));
const GROUP_HEX = 'ab'.repeat(16);
const GROUP = { idHex: GROUP_HEX, id: hexToBytes(GROUP_HEX) };

const token = utf8ToBytes('fcm-device-token');
const REG: DeviceRegistration = {
  platform: 'fcm',
  token,
  fingerprint: tokenFingerprint('fcm', token),
  server: SERVER,
  relayHint: 'wss://nos.lol',
};

const nsecSigner =
  (sk: Uint8Array): Sign =>
  async (template) =>
    finalizeEvent({ ...template }, sk) as unknown as Awaited<ReturnType<Sign>>;

describe('owner-proof signing (MIP-05 "Removal signing test vector")', () => {
  it('signs the spec fixture with key 3 and zero aux randomness byte for byte', async () => {
    const sk = hexToBytes('00'.repeat(31) + '03');
    const removal = {
      member: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      leaf: 3,
      platform: 'apns' as const,
      server: '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
      fingerprint: 'sha256:000102030405060708090a0b',
      ownerTs: 1700000000000,
    };
    const group = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const sign: Sign = async (t) => {
      const id = getEventHash(t);
      return { ...t, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sk, new Uint8Array(32))) };
    };
    const signed = await signEntry(removal, group, sign);
    expect(signed.ownerSig).toBe(
      '04c3588a6533399aeaebb6c596fab896186dd0af1f9724f2926d984d2876490c76e1d149127e0fa697d7f19a0807aa373e942f0eb33edc63071567f274ce3bec',
    );
  });
});

describe('our 447 / 449 entries', () => {
  const sk = generateSecretKey();
  const me = getPublicKey(sk);
  const leaves = new Set([leafKey(me, 2), leafKey('cd'.repeat(32), 0)]);

  it('round-trips a signed 447 through parsePushPayload and owner verification', async () => {
    const record = await signEntry(
      buildOwnRecord(REG, me, 2, 1_700_000_000_000),
      GROUP_HEX,
      nsecSigner(sk),
    );
    const event = tokenUpdateEvent(record);
    expect(event.kind).toBe(447);
    expect(event.tags).toEqual([['v', 'marmot-push-v1']]);
    const { records } = parsePushPayload(447, event.content, Date.now());
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
    expect(verifyOwnerSig(records[0], GROUP_HEX)).toBe(true);
    // Bound to its group: the same entry relayed into another group fails.
    expect(verifyOwnerSig(records[0], 'cd'.repeat(16))).toBe(false);
    const state = await applyPushPayload({}, 447, event.content, { ...GROUP, leaves }, Date.now());
    expect(Object.values(state).map((s) => s.record)).toEqual([record]);
  });

  it('omits relay_hint when there is none, and the entry still verifies', async () => {
    const noHint: DeviceRegistration = { ...REG, relayHint: undefined };
    const record = await signEntry(buildOwnRecord(noHint, me, 2, 5), GROUP_HEX, nsecSigner(sk));
    const content = JSON.parse(tokenUpdateEvent(record).content);
    expect(content.tokens[0]).not.toHaveProperty('relay_hint');
    const { records } = parsePushPayload(447, tokenUpdateEvent(record).content, Date.now());
    expect(verifyOwnerSig(records[0], GROUP_HEX)).toBe(true);
  });

  it('a newer 447 replaces the record, and a later 449 tombstones it', async () => {
    const sign = nsecSigner(sk);
    const first = await signEntry(buildOwnRecord(REG, me, 2, 1_000), GROUP_HEX, sign);
    const rotatedToken = utf8ToBytes('rotated-token');
    const rotated = await signEntry(
      buildOwnRecord(
        { ...REG, token: rotatedToken, fingerprint: tokenFingerprint('fcm', rotatedToken) },
        me,
        2,
        2_000,
      ),
      GROUP_HEX,
      sign,
    );
    const group = { ...GROUP, leaves };
    let state = await applyPushPayload({}, 447, tokenUpdateEvent(first).content, group, Date.now());
    state = await applyPushPayload(
      state,
      447,
      tokenUpdateEvent(rotated).content,
      group,
      Date.now(),
    );
    // Replayed older record loses the ordering race.
    state = await applyPushPayload(state, 447, tokenUpdateEvent(first).content, group, Date.now());
    expect(Object.values(state).map((s) => s.record?.fingerprint)).toEqual([rotated.fingerprint]);

    const removal = await signEntry(removalFor(rotated, 3_000), GROUP_HEX, sign);
    const removalEvent = tokenRemovalEvent(removal);
    expect(removalEvent.kind).toBe(449);
    expect(parsePushPayload(449, removalEvent.content, Date.now()).removals).toEqual([removal]);
    state = await applyPushPayload(state, 449, removalEvent.content, group, Date.now());
    expect(Object.values(state).map((s) => s.record)).toEqual([null]);
  });

  it('seals the token afresh per record (the fingerprint stays the same)', () => {
    const a = buildOwnRecord(REG, me, 2, 1);
    const b = buildOwnRecord(REG, me, 2, 1);
    expect(a.encryptedToken).not.toBe(b.encryptedToken);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe('ownerSigFromSigned — the external-signer trust boundary', () => {
  const sk = generateSecretKey();
  const record: PushRecord = {
    ...buildOwnRecord(REG, getPublicKey(sk), 1, 42),
    ownerSig: '',
  };
  const template = ownerProofEvent(record, GROUP_HEX);
  const good = finalizeEvent({ ...template }, sk);

  it('accepts the exact signed template', () => {
    expect(ownerSigFromSigned(template, good)).toBe(good.sig);
  });

  it('rejects a signer that changed created_at, tags, kind or content', () => {
    const tampered = [
      finalizeEvent({ ...template, created_at: 1_700_000_000 }, sk),
      finalizeEvent({ ...template, tags: [...template.tags, ['client', 'x']] }, sk),
      finalizeEvent({ ...template, kind: 450 }, sk),
      finalizeEvent({ ...template, content: '' }, sk),
    ];
    for (const t of tampered) expect(() => ownerSigFromSigned(template, t)).toThrow();
  });

  it('rejects a missing / malformed result (Amber can return "null")', () => {
    expect(() => ownerSigFromSigned(template, null as never)).toThrow(OwnerProofMismatch);
    expect(() => ownerSigFromSigned(template, {} as never)).toThrow(OwnerProofMismatch);
  });

  it('rejects a bad signature or another key', () => {
    expect(() => ownerSigFromSigned(template, { ...good, sig: '00'.repeat(64) })).toThrow();
    const other = finalizeEvent({ ...template }, generateSecretKey());
    expect(() => ownerSigFromSigned(template, other)).toThrow();
  });
});
