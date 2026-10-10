import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { nip19 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  anyCategory,
  buildRegistrationWrap,
  NO_CATEGORIES,
  normaliseWatcherRelay,
  nextRegistrationTs,
  nwcProof,
  nwcProofMessage,
  parseNwcConnection,
  registrationFingerprint,
  selectRegistrationRelays,
  WATCHER_PUBKEY,
  type RegisterContent,
  type SealSigner,
} from './watcherRegistration';

const ALL = { dm: true, zap: true, mention: true, payment: true };

describe('WATCHER_PUBKEY', () => {
  it('is the watcher npub', () => {
    expect(
      nip19.decode('npub17hcchazg4akxq4ccuskxmxegl2euyz8je7h6xjthekeyz8pux78qfzgph2').data,
    ).toBe(WATCHER_PUBKEY);
  });
});

describe('parseNwcConnection', () => {
  const wallet = 'b'.repeat(64);
  const secret = 'c'.repeat(64);

  it('reads the wallet, secret and every relay', () => {
    expect(
      parseNwcConnection(
        `nostr+walletconnect://${wallet}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&relay=wss://two.example&secret=${secret}`,
      ),
    ).toEqual({ wallet, secret, relays: ['wss://relay.getalby.com/v1', 'wss://two.example'] });
  });

  it('rejects other schemes and malformed keys', () => {
    expect(parseNwcConnection(`https://${wallet}?secret=${secret}`)).toBeNull();
    expect(parseNwcConnection(`nostr+walletconnect://xyz?secret=${secret}`)).toBeNull();
    expect(parseNwcConnection(`nostr+walletconnect://${wallet}?secret=nothex`)).toBeNull();
    expect(parseNwcConnection('not a url')).toBeNull();
  });
});

describe('nwcProof', () => {
  it('is a BIP-340 signature by the connection secret over the bound message', () => {
    const secret = generateSecretKey();
    const user = getPublicKey(generateSecretKey());
    const wallet = getPublicKey(generateSecretKey());
    const entry = nwcProof(user, { wallet, secret: bytesToHex(secret) });
    expect(entry.client).toBe(getPublicKey(secret));
    expect(entry.proof).toMatch(/^[0-9a-f]{128}$/);
    expect(
      schnorr.verify(
        hexToBytes(entry.proof),
        nwcProofMessage(user, wallet),
        hexToBytes(entry.client),
      ),
    ).toBe(true);
  });
});

describe('normaliseWatcherRelay', () => {
  it.each([
    ['wss://Relay.Example.com/', 'wss://relay.example.com'],
    ['wss://relay.getalby.com/v1/', 'wss://relay.getalby.com/v1'],
    ['wss://relay.example.com:4443', 'wss://relay.example.com:4443'],
  ])('%s → %s', (input, out) => expect(normaliseWatcherRelay(input)).toBe(out));

  it.each([
    'ws://relay.example.com',
    'wss://10.0.0.1',
    'wss://[::1]',
    'wss://localhost',
    'wss://relay.local',
    'wss://box.lan',
    'wss://x.onion',
    'wss://user:pw@relay.example.com',
    'wss://relay.example.com?auth=1',
    'wss://nodot',
    'garbage',
  ])('drops %s', (input) => expect(normaliseWatcherRelay(input)).toBeNull());
});

describe('selectRegistrationRelays', () => {
  const sources = {
    nwc: ['wss://nwc.example.com'],
    inbox: ['wss://inbox.example.com'],
    read: ['wss://read.example.com'],
  };

  it('orders NWC, then inbox, then read relays', () => {
    expect(selectRegistrationRelays(ALL, sources)).toEqual([
      'wss://nwc.example.com',
      'wss://inbox.example.com',
      'wss://read.example.com',
    ]);
  });

  it('only includes what the categories need', () => {
    expect(selectRegistrationRelays({ ...NO_CATEGORIES, payment: true }, sources)).toEqual([
      'wss://nwc.example.com',
    ]);
    expect(selectRegistrationRelays({ ...NO_CATEGORIES, zap: true }, sources)).toEqual([
      'wss://read.example.com',
    ]);
    expect(selectRegistrationRelays({ ...NO_CATEGORIES, dm: true }, sources)).toEqual([
      'wss://inbox.example.com',
      'wss://read.example.com',
    ]);
  });

  it("leaves out the watcher's own relays, dedupes, and caps at 8", () => {
    const read = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example.com`);
    const out = selectRegistrationRelays(ALL, {
      nwc: ['wss://nos.lol/', 'wss://relay.damus.io'],
      inbox: ['wss://relay.primal.net', 'wss://r0.example.com'],
      read,
    });
    expect(out).toHaveLength(8);
    expect(out[0]).toBe('wss://r0.example.com');
    expect(out).not.toContain('wss://nos.lol');
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('nextRegistrationTs', () => {
  it('is now, or last + 1 when now has not moved past it', () => {
    expect(nextRegistrationTs(100, 200)).toBe(200);
    expect(nextRegistrationTs(200, 200)).toBe(201);
    expect(nextRegistrationTs(250, 200)).toBe(251);
  });

  it('waits (null) rather than leave the watcher’s 2-minute future window', () => {
    expect(nextRegistrationTs(309, 200)).toBe(310);
    expect(nextRegistrationTs(400, 200)).toBeNull();
  });

  it('ignores a watermark the watcher can never have accepted (>6 h ahead)', () => {
    expect(nextRegistrationTs(200 + 7 * 3600, 200)).toBe(200);
  });
});

describe('registrationFingerprint', () => {
  const body: Omit<RegisterContent, 'ts' | 'v'> = {
    action: 'register',
    app: 'com.lightningpiggy.app',
    platform: 'fcm',
    token: 't'.repeat(40),
    categories: { ...NO_CATEGORIES, dm: true },
    relays: ['wss://a.example.com', 'wss://b.example.com'],
    nwc: [{ client: 'c'.repeat(64), wallet: 'w'.repeat(64), proof: 'x' }],
  };

  it('ignores proofs and relay order, but not categories or tokens', () => {
    const fp = registrationFingerprint(body);
    expect(
      registrationFingerprint({
        ...body,
        relays: [...body.relays].reverse(),
        nwc: [{ ...body.nwc[0], proof: 'y' }],
      }),
    ).toBe(fp);
    expect(
      registrationFingerprint({ ...body, categories: { ...body.categories, zap: true } }),
    ).not.toBe(fp);
    expect(registrationFingerprint({ ...body, token: 'u'.repeat(40) })).not.toBe(fp);
  });

  it('withRelays: false ignores the relay list', () => {
    const core = registrationFingerprint(body, { withRelays: false });
    expect(registrationFingerprint({ ...body, relays: [] }, { withRelays: false })).toBe(core);
    expect(registrationFingerprint({ ...body, relays: [] })).not.toBe(
      registrationFingerprint(body),
    );
  });
});

describe('anyCategory', () => {
  it('is false only when everything is off', () => {
    expect(anyCategory(NO_CATEGORIES)).toBe(false);
    expect(anyCategory({ ...NO_CATEGORIES, mention: true })).toBe(true);
  });
});

describe('buildRegistrationWrap — signer guards', () => {
  const sk = generateSecretKey();
  const base: SealSigner = {
    pubkey: getPublicKey(sk),
    nip44Encrypt: async () => 'ciphertext',
    signEvent: async (t) => finalizeEvent(t, sk),
  };
  const body = {
    action: 'unregister' as const,
    app: 'com.lightningpiggy.app',
    platform: 'fcm' as const,
    token: 't'.repeat(40),
  };

  it('refuses a seal signed by another key', async () => {
    const other = generateSecretKey();
    await expect(
      buildRegistrationWrap({ ...base, signEvent: async (t) => finalizeEvent(t, other) }, body, 1),
    ).rejects.toThrow('unexpected seal');
  });

  it('refuses a seal whose signature does not verify', async () => {
    await expect(
      buildRegistrationWrap(
        { ...base, signEvent: async (t) => ({ ...finalizeEvent(t, sk), sig: '0'.repeat(128) }) },
        body,
        1,
      ),
    ).rejects.toThrow('seal signature invalid');
  });

  it('propagates a declined signature', async () => {
    await expect(
      buildRegistrationWrap(
        {
          ...base,
          signEvent: async () => {
            throw new Error('declined');
          },
        },
        body,
        1,
      ),
    ).rejects.toThrow('declined');
  });
});
