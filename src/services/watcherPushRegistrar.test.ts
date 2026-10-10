import { bytesToHex } from '@noble/hashes/utils.js';
import { getConversationKey, decrypt as nip44Decrypt, encrypt } from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure';

import type { PushDevice } from './marmotPushRegistration';
import type { RegisteredRecord, WatcherAccountState } from './watcherPushStore';
import {
  planWatcherSync,
  REFRESH_AFTER_MS,
  WatcherPushRegistrar,
  type Desired,
  type SyncTrigger,
  type WatcherContext,
  type WatcherDeps,
} from './watcherPushRegistrar';
import {
  NO_CATEGORIES,
  pushTokenHash,
  WATCHER_PUBKEY,
  type SealSigner,
} from './watcherRegistration';

// --- planWatcherSync ------------------------------------------------------------

const NOW = 1_800_000_000_000;
const desired: Desired = { fingerprint: 'F', coreFingerprint: 'C', tokenHash: 'T' };
const record = (over: Partial<RegisteredRecord> = {}): RegisteredRecord => ({
  fingerprint: 'F',
  coreFingerprint: 'C',
  tokenHash: 'T',
  platform: 'fcm',
  app: 'com.lightningpiggy.app',
  at: NOW - 1000,
  ...over,
});
const plan = (
  d: Desired | null,
  r: RegisteredRecord | null,
  triggers: SyncTrigger[],
  silentSigner = false,
) =>
  planWatcherSync({
    desired: d,
    registered: r,
    triggers: new Set(triggers),
    silentSigner,
    nowMs: NOW,
  });

describe('planWatcherSync', () => {
  it('nothing wanted, nothing held → none', () => {
    expect(plan(null, null, ['start'])).toBe('none');
  });

  it('first registration: user actions go, plain start defers for a remote signer', () => {
    expect(plan(desired, null, ['user'])).toBe('register');
    expect(plan(desired, null, ['nwc'])).toBe('register');
    expect(plan(desired, null, ['start'])).toBe('defer');
    expect(plan(desired, null, ['start'], true)).toBe('register'); // nsec: silent
  });

  it('all off: unregister on a user action, defer at start for a remote signer', () => {
    expect(plan(null, record(), ['user'])).toBe('unregister');
    expect(plan(null, record(), ['start'])).toBe('defer');
    expect(plan(null, record(), ['start'], true)).toBe('unregister');
  });

  it('unchanged → none, unless the 7-day refresh is due (even at plain start)', () => {
    expect(plan(desired, record(), ['start'])).toBe('none');
    expect(plan(desired, record({ at: NOW - REFRESH_AFTER_MS }), ['start'])).toBe('register');
  });

  it('a new push token always registers', () => {
    expect(plan({ ...desired, tokenHash: 'T2' }, record(), ['start'])).toBe('register');
  });

  it('relay-only change: folded into the next registration for a remote signer', () => {
    const relaysMoved = { ...desired, fingerprint: 'F2' };
    expect(plan(relaysMoved, record(), ['relays'])).toBe('none');
    expect(plan(relaysMoved, record(), ['relays'], true)).toBe('register');
    expect(plan(relaysMoved, record(), ['user'])).toBe('register');
    expect(plan(relaysMoved, record({ at: NOW - REFRESH_AFTER_MS }), ['relays'])).toBe('register');
  });

  it('a real change (categories / NWC) registers on a user action, defers at start', () => {
    const changed = { ...desired, fingerprint: 'F2', coreFingerprint: 'C2' };
    expect(plan(changed, record(), ['user'])).toBe('register');
    expect(plan(changed, record(), ['nwc'])).toBe('register');
    expect(plan(changed, record(), ['start'])).toBe('defer');
    expect(plan(changed, record(), ['relays'])).toBe('defer');
  });
});

// --- WatcherPushRegistrar ---------------------------------------------------------

const userSk = generateSecretKey();
const USER = getPublicKey(userSk);
const FCM = 'fKq1:APA91bHPRgkF' + 'x'.repeat(60);
const nwcSecret = bytesToHex(generateSecretKey());
const nwcWallet = getPublicKey(generateSecretKey());

interface Harness {
  registrar: WatcherPushRegistrar;
  deps: WatcherDeps;
  store: Map<string, WatcherAccountState>;
  saves: WatcherAccountState[];
  published: NostrEvent[];
  signs: number;
  encrypts: number;
  setDevice(d: PushDevice | null | undefined): void;
  advance(ms: number): Promise<void>;
  clock: { now: number };
}

function harness(
  opts: {
    device?: PushDevice | null;
    state?: Partial<WatcherAccountState>;
    publishOk?: boolean;
    decline?: boolean;
  } = {},
): Harness {
  let device: PushDevice | null | undefined =
    'device' in opts ? opts.device : { platform: 'fcm', token: FCM };
  const clock = { now: NOW };
  const store = new Map<string, WatcherAccountState>();
  if (opts.state)
    store.set(USER, { categories: NO_CATEGORIES, lastTs: 0, registered: null, ...opts.state });
  const h: Partial<Harness> = { store, saves: [], published: [], signs: 0, encrypts: 0, clock };
  const signer = (pubkey: string, _type: unknown, cancelled = () => false): SealSigner => ({
    pubkey,
    nip44Encrypt: async (peer, pt) => {
      if (cancelled()) throw new Error('abandoned');
      h.encrypts! += 1;
      return encrypt(pt, getConversationKey(userSk, peer));
    },
    signEvent: async (t) => {
      if (cancelled()) throw new Error('abandoned');
      if (opts.decline) throw new Error('declined');
      h.signs! += 1;
      return finalizeEvent(t, userSk);
    },
  });
  const deps: WatcherDeps = {
    device: () => device,
    appId: () => 'com.lightningpiggy.app',
    apnsEnv: async () => undefined,
    nwcUrl: async () =>
      `nostr+walletconnect://${nwcWallet}?relay=wss://relay.getalby.com/v1&secret=${nwcSecret}`,
    signer,
    publish: async (wrap) => {
      h.published!.push(wrap);
      return opts.publishOk ?? true;
    },
    load: async (pk) => store.get(pk) ?? { categories: NO_CATEGORIES, lastTs: 0, registered: null },
    save: async (pk, s) => {
      store.set(pk, s);
      h.saves!.push(s);
    },
    now: () => clock.now,
  };
  h.deps = deps;
  h.registrar = new WatcherPushRegistrar(deps);
  h.setDevice = (d) => {
    device = d;
    h.registrar!.onDeviceChanged();
  };
  h.advance = async (ms) => {
    clock.now += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };
  return h as Harness;
}

const ctx = (over: Partial<WatcherContext> = {}): WatcherContext => ({
  pubkey: USER,
  signerType: 'amber',
  inboxRelays: ['wss://inbox.example.com'],
  readRelays: ['wss://read.example.com'],
  nwcWalletIds: ['w1'],
  ...over,
});

/** Captures the seal plaintexts (the rumors) the registrar encrypts. */
function captureRumors(h: Harness): Record<string, unknown>[] {
  const rumors: Record<string, unknown>[] = [];
  const original = h.deps.signer;
  h.deps.signer = (pk, type, cancelled) => {
    const s = original(pk, type, cancelled);
    return {
      ...s,
      nip44Encrypt: async (peer, pt) => {
        expect(peer).toBe(WATCHER_PUBKEY);
        rumors.push(JSON.parse(pt));
        return s.nip44Encrypt(peer, pt);
      },
    };
  };
  return rumors;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('WatcherPushRegistrar lifecycle', () => {
  it('a burst of toggles becomes ONE signature after the debounce', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.advance(3_000); // start: nothing on → nothing to do
    expect(h.signs).toBe(0);

    await h.registrar.setCategory('dm', true);
    await h.advance(500);
    await h.registrar.setCategory('zap', true);
    await h.advance(500);
    await h.registrar.setCategory('mention', true);
    expect(h.signs).toBe(0); // still debouncing
    await h.advance(2_500);

    expect(h.signs).toBe(1);
    expect(h.published).toHaveLength(1);
    const content = JSON.parse(rumors[0].content as string);
    expect(content).toMatchObject({
      v: 1,
      action: 'register',
      app: 'com.lightningpiggy.app',
      platform: 'fcm',
      token: FCM,
      categories: { dm: true, zap: true, mention: true, payment: false },
      relays: ['wss://inbox.example.com', 'wss://read.example.com'],
      nwc: [],
    });
    expect(content.ts).toBe(rumors[0].created_at);
    expect(h.registrar.getStatus().last).toBe('registered');
    expect(h.store.get(USER)?.registered?.tokenHash).toBe(pushTokenHash('fcm', FCM));
    // The raw token is never persisted.
    expect(JSON.stringify([...h.store.values()])).not.toContain(FCM);
  });

  it('plain app start does not prompt a remote signer for a stale change — pending instead', async () => {
    const h = harness({ state: { categories: { ...NO_CATEGORIES, dm: true } } });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.advance(3_000);
    expect(h.signs).toBe(0);
    expect(h.registrar.getStatus().last).toBe('pending');
    // Retry (user action) does it.
    await expect(h.registrar.syncNow()).resolves.toBe('registered');
    expect(h.signs).toBe(1);
  });

  it('refreshes at start once the registration is 7 days old', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx({ signerType: 'nsec' }));
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    expect(h.signs).toBe(1);

    // A later app start within the week: nothing.
    const again = new WatcherPushRegistrar({ ...h.deps });
    again.setContext(ctx());
    again.onDeviceChanged();
    await h.advance(3_000);
    expect(h.signs).toBe(1);

    // And after a week, even a remote signer refreshes.
    h.clock.now += REFRESH_AFTER_MS;
    const later = new WatcherPushRegistrar({ ...h.deps });
    later.setContext(ctx());
    later.onDeviceChanged();
    await h.advance(3_000);
    expect(h.signs).toBe(2);
    expect(rumors[1].created_at as number).toBeGreaterThan(rumors[0].created_at as number);
  });

  it('a token change re-registers with the new token', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('mention', true);
    await h.advance(3_000);
    h.setDevice({ platform: 'fcm', token: 'NEW' + FCM });
    await h.advance(3_000);
    expect(h.signs).toBe(2);
    expect(JSON.parse(rumors[1].content as string).token).toBe('NEW' + FCM);
  });

  it('NWC: proofs for each connection, its relay first; a wallet change re-registers', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx({ nwcWalletIds: [] }));
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('payment', true);
    await h.advance(3_000);
    expect(JSON.parse(rumors[0].content as string).nwc).toEqual([]);

    h.registrar.setContext(ctx({ nwcWalletIds: ['w1'] }));
    await h.advance(3_000);
    expect(h.signs).toBe(2);
    const content = JSON.parse(rumors[1].content as string);
    expect(content.nwc).toEqual([
      {
        client: getPublicKey(Buffer.from(nwcSecret, 'hex')),
        wallet: nwcWallet,
        proof: expect.stringMatching(/^[0-9a-f]{128}$/),
      },
    ]);
    expect(content.relays[0]).toBe('wss://relay.getalby.com/v1');
  });

  it('relay-list churn alone never prompts a remote signer', async () => {
    const h = harness();
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    h.registrar.setContext(ctx({ inboxRelays: ['wss://other.example.com'] }));
    await h.advance(15_000);
    expect(h.signs).toBe(1);
  });

  it('relay-list changes re-register silently for an nsec signer', async () => {
    const h = harness();
    h.registrar.setContext(ctx({ signerType: 'nsec' }));
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    h.registrar.setContext(ctx({ signerType: 'nsec', inboxRelays: ['wss://other.example.com'] }));
    await h.advance(5_000);
    expect(h.signs).toBe(1); // relays wait longer to settle…
    await h.advance(6_000);
    expect(h.signs).toBe(2);
  });

  it('turning every category off unregisters', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    await h.registrar.setCategory('dm', false);
    await h.advance(3_000);
    expect(JSON.parse(rumors[1].content as string)).toMatchObject({
      action: 'unregister',
      token: FCM,
    });
    expect(h.store.get(USER)?.registered).toBeNull();
  });

  it('unregisterNow (push being turned off) uses the registered token and cancels a pending sync', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    await h.registrar.setCategory('zap', true); // pending debounce…
    await expect(h.registrar.unregisterNow()).resolves.toBe(true);
    h.setDevice(null); // Marmot push deletes the token
    await h.advance(5_000);
    expect(rumors.map((r) => JSON.parse(r.content as string).action)).toEqual([
      'register',
      'unregister',
    ]);
  });

  it('an unregister for a token that is already gone signs nothing and forgets it', async () => {
    const h = harness({
      state: {
        categories: NO_CATEGORIES,
        lastTs: 10,
        registered: {
          fingerprint: 'F',
          coreFingerprint: 'C',
          tokenHash: pushTokenHash('fcm', 'OLD' + FCM),
          platform: 'fcm',
          app: 'com.lightningpiggy.app',
          at: NOW,
        },
      },
    });
    h.registrar.setContext(ctx());
    await expect(h.registrar.unregisterNow()).resolves.toBe(true);
    expect(h.signs).toBe(0);
    expect(h.store.get(USER)?.registered).toBeNull();
  });

  it('ts strictly increases and is persisted before publishing', async () => {
    const h = harness({ state: { lastTs: Math.floor(NOW / 1000) + 5 } });
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    const ts = rumors[0].created_at as number;
    expect(ts).toBe(Math.floor(NOW / 1000) + 6);
    // Saves: the toggle, the write-ahead ts, then the registered record.
    const writeAhead = h.saves.find((s) => s.lastTs === ts && !s.registered);
    expect(writeAhead).toBeDefined();
  });

  it('a declined signature leaves it pending for Retry, with the ts burned', async () => {
    const h = harness({ decline: true });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    expect(h.registrar.getStatus().last).toBe('failed');
    expect(h.store.get(USER)?.registered).toBeNull();
    expect(h.store.get(USER)?.lastTs).toBeGreaterThan(0);
  });

  it('no relay acking it is a failure — kept as "possibly registered", so push-off still unregisters', async () => {
    const h = harness({ publishOk: false });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    expect(h.registrar.getStatus().last).toBe('failed');
    // A relay may have taken it without the ack arriving.
    expect(h.store.get(USER)?.registered).toMatchObject({ fingerprint: 'unconfirmed' });
    const signs = h.signs;
    await h.registrar.unregisterNow();
    expect(h.signs).toBe(signs + 1); // an unregister is signed and sent for it
  });

  it('waits for the token: a toggle before it is known registers once it arrives', async () => {
    const h = harness({ device: undefined });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    expect(h.signs).toBe(0);
    h.setDevice({ platform: 'fcm', token: FCM });
    await h.advance(3_000);
    expect(h.signs).toBe(1); // the user's toggle carried over
  });

  it('push off: no registration, and the token going away triggers nothing', async () => {
    const h = harness({ device: null, state: { categories: { ...NO_CATEGORIES, dm: true } } });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.advance(5_000);
    expect(h.published).toHaveLength(0);
  });

  it('an account switch starts from that account’s own state', async () => {
    const h = harness();
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    const other = getPublicKey(generateSecretKey());
    h.registrar.setContext(ctx({ pubkey: other }));
    await h.advance(3_000);
    expect(h.signs).toBe(1);
    await expect(h.registrar.categories()).resolves.toEqual(NO_CATEGORIES);
  });

  it('seals are encrypted to the watcher (only it can open them)', async () => {
    const h = harness();
    let sealed = '';
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        signEvent: async (t) => {
          sealed = t.content;
          return s.signEvent(t);
        },
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    const rumor = JSON.parse(nip44Decrypt(sealed, getConversationKey(userSk, WATCHER_PUBKEY)));
    expect(rumor).toMatchObject({ kind: 8480, pubkey: USER, tags: [] });
  });
});

describe('WatcherPushRegistrar account teardown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a registration prepared for an account that signs out meanwhile is not published', async () => {
    const h = harness();
    let release: (() => void) | null = null;
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        // The signer (Amber) is still waiting for the user…
        signEvent: (t) => new Promise((r) => (release = () => r(s.signEvent(t)))),
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(release).not.toBeNull(); // the signature was requested
    h.registrar.setContext(null); // …and the account signs out.
    release!();
    await h.advance(100);
    expect(h.published).toHaveLength(0);
  });
});

describe('WatcherPushRegistrar round-2 guards', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a switch while the registration is still being prepared stops it going out', async () => {
    const h = harness();
    let releaseNwc: (() => void) | null = null;
    const original = h.deps.nwcUrl;
    h.deps.nwcUrl = (id) => new Promise((r) => (releaseNwc = () => r(original(id))));
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('payment', true);
    await h.advance(2_500);
    expect(releaseNwc).not.toBeNull(); // preparing (reading the NWC secret)
    h.registrar.setContext(ctx({ pubkey: getPublicKey(generateSecretKey()) }));
    releaseNwc!();
    await h.advance(100);
    expect(h.published).toHaveLength(0);
  });

  it('a queued sign-out unregister stays bound to its account, never the successor', async () => {
    const h = harness();
    const rumors = captureRumors(h);
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    const done = h.registrar.unregisterNow();
    h.registrar.setContext(ctx({ pubkey: getPublicKey(generateSecretKey()) }));
    await expect(done).resolves.toBe(true);
    expect(rumors.map((r) => [JSON.parse(r.content as string).action, r.pubkey])).toEqual([
      ['register', USER],
      ['unregister', USER],
    ]);
  });

  it('an abandoned (timed-out) unregister never runs', async () => {
    const h = harness();
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    await expect(h.registrar.unregisterNow(() => true)).resolves.toBe(false);
    expect(h.published).toHaveLength(1); // only the register
  });

  it('after the clock went back it waits (pending) instead of sending a refused ts', async () => {
    const h = harness({ state: { lastTs: Math.floor(NOW / 1000) + 3600 } });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(h.published).toHaveLength(0);
    expect(h.registrar.getStatus().last).toBe('pending');
    expect(h.store.get(USER)?.lastTs).toBe(Math.floor(NOW / 1000) + 3600);
  });
});

describe('WatcherPushRegistrar never prompts for an abandoned request', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('an account that signs out between encrypt and sign is never asked to sign', async () => {
    const h = harness();
    let releaseEncrypt: (() => void) | null = null;
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        nip44Encrypt: (peer, pt) =>
          new Promise((r) => (releaseEncrypt = () => r(s.nip44Encrypt(peer, pt)))),
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(releaseEncrypt).not.toBeNull();
    h.registrar.setContext(null);
    releaseEncrypt!();
    await h.advance(100);
    expect(h.signs).toBe(0);
    expect(h.published).toHaveLength(0);
  });

  it('an unregister abandoned before it starts asks the signer for nothing', async () => {
    const h = harness();
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    const encryptsBefore = h.encrypts;
    let gaveUp = false;
    const done = h.registrar.unregisterNow(() => gaveUp);
    gaveUp = true;
    await expect(done).resolves.toBe(false);
    expect(h.encrypts).toBe(encryptsBefore);
  });
});

describe('WatcherPushRegistrar push-off vs an in-flight registration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a registration whose signer answers after the unregister started is not published', async () => {
    const h = harness();
    let release: (() => void) | null = null;
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        signEvent: (t) => new Promise((r) => (release = () => r(finalizeEvent(t, userSk)))),
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(release).not.toBeNull(); // the register is waiting on the signer
    void h.registrar.unregisterNow(() => true); // push-off begins (and gives up)
    h.setDevice(null); // Marmot push deletes the token
    release!();
    await h.advance(100);
    expect(h.published).toHaveLength(0);
  });
});

describe('WatcherPushRegistrar per-account token', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a register never goes out once its account no longer has the token — even with no device event', async () => {
    const h = harness();
    let release: (() => void) | null = null;
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        signEvent: (t) => new Promise((r) => (release = () => r(finalizeEvent(t, userSk)))),
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(release).not.toBeNull();
    // Push turned off for THIS account while another keeps the phone's token:
    // its device view goes null; no onDeviceChanged reaches the registrar.
    h.setDevice(null);
    release!();
    await h.advance(100);
    expect(h.published).toHaveLength(0);
  });

  it('switching to an account without push takes its (null) device view — no stale snapshot', async () => {
    const h = harness({ device: null });
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.advance(3_000);
    // That account turns push on: a real change, scheduled once.
    h.setDevice({ platform: 'fcm', token: FCM });
    h.registrar.onDeviceChanged();
    h.registrar.onDeviceChanged(); // a repeat announcement changes nothing
    await h.registrar.setCategory('dm', true);
    await h.advance(3_000);
    expect(h.published).toHaveLength(1);
  });
});

describe('WatcherPushRegistrar account isolation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a toggle queued behind a busy signer never changes the next account's choices", async () => {
    const h = harness();
    let release: (() => void) | null = null;
    const original = h.deps.signer;
    h.deps.signer = (pk, type, cancelled) => {
      const s = original(pk, type, cancelled);
      return {
        ...s,
        signEvent: (t) => new Promise((r) => (release = () => r(finalizeEvent(t, userSk)))),
      };
    };
    h.registrar.setContext(ctx());
    h.registrar.onDeviceChanged();
    await h.registrar.setCategory('dm', true);
    await h.advance(2_500);
    expect(release).not.toBeNull(); // A's registration waits on the signer
    const toggled = h.registrar.setCategory('zap', true); // queued behind it
    const other = getPublicKey(generateSecretKey());
    h.registrar.setContext(ctx({ pubkey: other }));
    release!();
    await expect(toggled).resolves.toBeNull();
    expect(h.store.get(other)).toBeUndefined();
  });
});
