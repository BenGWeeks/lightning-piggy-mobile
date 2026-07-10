import {
  GC_COMMENT_KIND,
  GC_FOUND_LOG_KIND,
  GC_LISTING_KIND,
  LP_LABEL_NAMESPACE,
  LP_LABEL_VALUE,
  buildCacheListing,
  buildComment,
  buildFoundLog,
  hasLpLabel,
  longestGeohash,
  parseCache,
  parseCacheCoord,
  parseFoundLogEvent,
} from './nostrPlacesService';
import type { HiddenPiggy } from './piggyStorageService';
import type { VerifiedEvent } from 'nostr-tools';

const makePiggy = (overrides: Partial<HiddenPiggy> = {}): HiddenPiggy => ({
  id: 'piggy_xyz',
  lnurlw: 'lightning:LNURL1abc',
  lnurlDescription: 'Geo-Cache 1 — 21 sats per claim',
  createdAt: Date.now(),
  isPublic: true,
  lat: 52.283602,
  lon: 0.043889,
  geohash: 'u1212vzyn',
  ...overrides,
});

describe('buildCacheListing', () => {
  it('emits NIP-GC kind 37516 with required fields and com.lightningpiggy.app label', () => {
    const evt = buildCacheListing(makePiggy());
    expect(evt.kind).toBe(GC_LISTING_KIND);
    const tagNames = evt.tags.map((t) => t[0]);
    expect(tagNames).toContain('d');
    expect(tagNames).toContain('name');
    expect(tagNames).toContain('D');
    expect(tagNames).toContain('T');
    expect(tagNames).toContain('S');
    expect(tagNames).toContain('t');
    expect(tagNames).toContain('expiration');
    expect(tagNames).toContain('L');
    expect(tagNames).toContain('l');
  });

  it('SECURITY: never includes the lnurl tag on the published event', () => {
    // The bearer-token leak we caught — assert it stays out for ever.
    const evt = buildCacheListing(makePiggy({ lnurlw: 'lightning:LNURL1secretbearer' }));
    const lnurlTag = evt.tags.find((t) => t[0] === 'lnurl');
    expect(lnurlTag).toBeUndefined();
    // The content + tags should not contain the LNURL string anywhere.
    const allText = JSON.stringify(evt);
    expect(allText).not.toContain('LNURL1secretbearer');
  });

  it('emits multi-precision g tags from 3 to 9 chars', () => {
    const evt = buildCacheListing(makePiggy());
    const gtags = evt.tags.filter((t) => t[0] === 'g').map((t) => t[1]);
    expect(gtags.length).toBe(7);
    expect(gtags).toEqual(['u12', 'u121', 'u1212', 'u1212v', 'u1212vz', 'u1212vzy', 'u1212vzyn']);
  });

  it('applies smart defaults (D=1, T=1, S=micro, t=traditional)', () => {
    const evt = buildCacheListing(makePiggy());
    expect(evt.tags.find((t) => t[0] === 'D')).toEqual(['D', '1']);
    expect(evt.tags.find((t) => t[0] === 'T')).toEqual(['T', '1']);
    expect(evt.tags.find((t) => t[0] === 'S')).toEqual(['S', 'micro']);
    expect(evt.tags.find((t) => t[0] === 't')).toEqual(['t', 'traditional']);
  });

  it('honours user-provided D / T / S / cacheType overrides', () => {
    const evt = buildCacheListing(
      makePiggy({ difficulty: 4, terrain: 3, size: 'small', cacheType: 'mystery' }),
    );
    expect(evt.tags.find((t) => t[0] === 'D')).toEqual(['D', '4']);
    expect(evt.tags.find((t) => t[0] === 'T')).toEqual(['T', '3']);
    expect(evt.tags.find((t) => t[0] === 'S')).toEqual(['S', 'small']);
    expect(evt.tags.find((t) => t[0] === 't')).toEqual(['t', 'mystery']);
  });

  it('ROT13-encodes the hint per NIP-GC client guidance', () => {
    const evt = buildCacheListing(makePiggy({ hint: 'In the branches' }));
    const hint = evt.tags.find((t) => t[0] === 'hint')?.[1];
    expect(hint).toBe('Va gur oenapurf');
  });

  it('throws if no lat/lon present', () => {
    expect(() => buildCacheListing(makePiggy({ lat: undefined, lon: undefined }))).toThrow(
      /no lat\/lon/i,
    );
  });

  it('falls back to lnurlDescription first 60 chars when no name set', () => {
    const lnurlDescription =
      'A very long link title that exceeds sixty characters by some margin OK?';
    const evt = buildCacheListing(makePiggy({ name: undefined, lnurlDescription }));
    const name = evt.tags.find((t) => t[0] === 'name')?.[1];
    expect(name).toBe(lnurlDescription.slice(0, 60));
  });

  it('publishes wait / uses / amount display hints when present', () => {
    const evt = buildCacheListing(
      makePiggy({ waitSecondsHint: 10800, usesHint: 100, maxWithdrawableMsat: 21000 }),
    );
    expect(evt.tags).toContainEqual(['wait', '10800']);
    expect(evt.tags).toContainEqual(['uses', '100']);
    expect(evt.tags).toContainEqual(['amount', '21']);
  });

  it('omits wait / uses / amount tags when the piggy has no such hints', () => {
    const names = buildCacheListing(makePiggy()).tags.map((t) => t[0]);
    expect(names).not.toContain('wait');
    expect(names).not.toContain('uses');
    expect(names).not.toContain('amount');
  });

  it('omits the amount tag for a 0 maxWithdrawable (never advertises "0 sats", #626)', () => {
    expect(buildCacheListing(makePiggy({ maxWithdrawableMsat: 0 })).tags).not.toContainEqual([
      'amount',
      '0',
    ]);
  });

  it('omits the amount tag for a sub-1000-msat maxWithdrawable (floors to 0 sats)', () => {
    const names = buildCacheListing(makePiggy({ maxWithdrawableMsat: 500 })).tags.map((t) => t[0]);
    expect(names).not.toContain('amount');
  });

  it('omits the wait / uses / amount LP hints on a plain non-LP cache, even if set (#681)', () => {
    // No link, not LP, but the hint fields somehow carry values — the
    // publisher must not stamp LP-only tags onto a plain NIP-GC cache,
    // or downstream UIs render a "Prize"/cooldown chip with no L/l label.
    const names = buildCacheListing(
      makePiggy({
        lnurlw: '',
        isLpPiggy: false,
        maxWithdrawableMsat: 21000,
        waitSecondsHint: 10800,
        usesHint: 100,
      }),
    ).tags.map((t) => t[0]);
    expect(names).not.toContain('amount');
    expect(names).not.toContain('wait');
    expect(names).not.toContain('uses');
    expect(names).not.toContain('L');
  });

  it('stamps the LP label when a withdraw link is present (#681)', () => {
    expect(buildCacheListing(makePiggy({ lnurlw: 'lightning:LNURL1abc' })).tags).toContainEqual([
      'L',
      LP_LABEL_NAMESPACE,
    ]);
  });

  it('omits the LP label for a plain NIP-GC cache — no link, not LP (no silent convert, #681)', () => {
    const names = buildCacheListing(makePiggy({ lnurlw: '', isLpPiggy: false })).tags.map(
      (t) => t[0],
    );
    expect(names).not.toContain('L');
    expect(names).not.toContain('l');
  });

  it('stamps the LP label on a cross-device edit (isLpPiggy set, bearer absent — #596 / #681)', () => {
    // The LNURL bearer lives on the original device, so `lnurlw` is blank
    // here; LP-ness rides on the flag carried from the published event.
    // Dropping the label would downgrade a real Piglet to a plain cache.
    const tags = buildCacheListing(makePiggy({ lnurlw: '', isLpPiggy: true })).tags;
    expect(tags).toContainEqual(['L', LP_LABEL_NAMESPACE]);
    expect(tags).toContainEqual(['l', LP_LABEL_VALUE, LP_LABEL_NAMESPACE]);
  });
});

describe('buildFoundLog', () => {
  it('emits kind 7516 with the cache coord on the `a` tag', () => {
    const evt = buildFoundLog('37516:abcd:piggy_xyz', 'Found it!');
    expect(evt.kind).toBe(GC_FOUND_LOG_KIND);
    expect(evt.tags).toContainEqual(['a', '37516:abcd:piggy_xyz']);
    expect(evt.content).toBe('Found it!');
  });

  it('includes optional image + amount tags', () => {
    const evt = buildFoundLog('37516:abcd:piggy', 'Got it', {
      imageUrl: 'https://blossom/x.jpg',
      sats: 21,
    });
    expect(evt.tags).toContainEqual(['image', 'https://blossom/x.jpg']);
    expect(evt.tags).toContainEqual(['amount', '21']);
  });

  it('omits sats tag for zero / undefined / negative', () => {
    expect(buildFoundLog('37516:abcd:p', '', { sats: 0 }).tags).not.toContainEqual(['amount', '0']);
    expect(
      buildFoundLog('37516:abcd:p', '', { sats: -5 }).tags.find((t) => t[0] === 'amount'),
    ).toBeUndefined();
  });

  it('SECURITY: never includes the lnurl tag or surfaces a bearer string anywhere in the event', () => {
    // Mirror of the buildListing security test — finder-side flow must
    // also stay leak-free. The find-log doesn't *have* an LNURL field
    // to populate, but a future regression could surface it through
    // content or a tag inherited from the cache. Re-checked on every
    // build so a refactor can't quietly add one.
    const evt = buildFoundLog('37516:abcd:piggy', 'Found it!', { imageUrl: 'https://x/y.jpg' });
    expect(evt.tags.find((t) => t[0] === 'lnurl')).toBeUndefined();
    expect(JSON.stringify(evt)).not.toMatch(/lnurl1[a-z0-9]/i);
  });
});

describe('buildComment', () => {
  it('emits kind 1111 NIP-22 with both A/K/P (root) and a/k/p (parent) for a top-level comment', () => {
    const evt = buildComment('37516:abcd:p', 'abcd', 'cache is missing', 'maintenance');
    expect(evt.kind).toBe(GC_COMMENT_KIND);
    expect(evt.tags).toContainEqual(['A', '37516:abcd:p']);
    expect(evt.tags).toContainEqual(['K', '37516']);
    expect(evt.tags).toContainEqual(['P', 'abcd']);
    expect(evt.tags).toContainEqual(['a', '37516:abcd:p']);
    expect(evt.tags).toContainEqual(['k', '37516']);
    expect(evt.tags).toContainEqual(['p', 'abcd']);
    expect(evt.tags).toContainEqual(['t', 'maintenance']);
  });

  it('defaults to `note` type when not specified', () => {
    const evt = buildComment('37516:abcd:p', 'abcd', 'just a note');
    expect(evt.tags.find((t) => t[0] === 't')).toEqual(['t', 'note']);
  });

  it('SECURITY: never includes the lnurl tag or surfaces a bearer string anywhere in the event', () => {
    // Comments are user-written free text — defensive belt-and-braces
    // assertion so a future regression that copy-pastes from the cache
    // detail (where the LNURL lives in SecureStore) into a comment
    // build call doesn't ship the bearer to the relays.
    const evt = buildComment('37516:abcd:p', 'abcd', 'this thread looks fine', 'note');
    expect(evt.tags.find((t) => t[0] === 'lnurl')).toBeUndefined();
    expect(JSON.stringify(evt)).not.toMatch(/lnurl1[a-z0-9]/i);
  });
});

describe('hasLpLabel', () => {
  it('returns true when the com.lightningpiggy.app label is present', () => {
    expect(
      hasLpLabel([
        ['L', LP_LABEL_NAMESPACE],
        ['l', LP_LABEL_VALUE, LP_LABEL_NAMESPACE],
      ]),
    ).toBe(true);
  });

  it('returns false when only an L (namespace) tag is present without the matching l value', () => {
    expect(hasLpLabel([['L', LP_LABEL_NAMESPACE]])).toBe(false);
  });

  it('returns false for unrelated labels', () => {
    expect(hasLpLabel([['l', 'spam', 'social.nos.ontology']])).toBe(false);
  });
});

describe('longestGeohash', () => {
  it('returns the longest g tag value', () => {
    expect(
      longestGeohash([
        ['g', 'u12'],
        ['g', 'u1212vz'],
        ['g', 'u1212v'],
      ]),
    ).toBe('u1212vz');
  });
  it('returns null when no g tags present', () => {
    expect(longestGeohash([['d', 'piggy_x']])).toBeNull();
  });
});

describe('parseCache', () => {
  const sampleEvent = (overrides: Partial<VerifiedEvent> = {}): VerifiedEvent =>
    ({
      id: 'evt1',
      pubkey: 'hiderpubkey',
      sig: 'sig',
      kind: GC_LISTING_KIND,
      created_at: 1700000000,
      content: 'A test cache',
      tags: [
        ['d', 'piggy_xyz'],
        ['name', 'Test Piggy'],
        ['g', 'u1212vz'],
        ['g', 'u1212v'],
        ['D', '1'],
        ['T', '2'],
        ['S', 'micro'],
        ['t', 'traditional'],
        ['hint', 'Va gur oenapurf'], // ROT13 of "In the branches"
        ['image', 'https://blossom/x.jpg'],
        ['L', LP_LABEL_NAMESPACE],
        ['l', LP_LABEL_VALUE, LP_LABEL_NAMESPACE],
        ['expiration', '1800000000'],
      ],
      ...overrides,
    }) as VerifiedEvent;

  it('parses the standard fields out of a kind 37516 event', () => {
    const c = parseCache(sampleEvent());
    expect(c).not.toBeNull();
    expect(c!.coord).toBe(`37516:hiderpubkey:piggy_xyz`);
    expect(c!.name).toBe('Test Piggy');
    expect(c!.geohash).toBe('u1212vz');
    expect(c!.difficulty).toBe(1);
    expect(c!.terrain).toBe(2);
    expect(c!.size).toBe('micro');
    expect(c!.cacheType).toBe('traditional');
    expect(c!.imageUrl).toBe('https://blossom/x.jpg');
    expect(c!.isLpPiggy).toBe(true);
    expect(c!.expiresAt).toBe(1800000000);
  });

  it('decodes the ROT13 hint back to plaintext', () => {
    expect(parseCache(sampleEvent())!.hint).toBe('In the branches');
  });

  it('returns null on non-37516 events', () => {
    expect(parseCache(sampleEvent({ kind: 1 }))).toBeNull();
  });

  it('returns null on missing d tag', () => {
    const noD = sampleEvent({ tags: [['name', 'No d tag']] });
    expect(parseCache(noD)).toBeNull();
  });

  it('isLpPiggy=false when label absent (treasures.to / TapTheSatsMap caches)', () => {
    const noLabel = sampleEvent({
      tags: [
        ['d', 'piggy'],
        ['name', 'Plain cache'],
        ['g', 'u1212vz'],
      ],
    });
    expect(parseCache(noLabel)!.isLpPiggy).toBe(false);
  });
});

describe('parseCacheCoord', () => {
  it('parses a well-formed coord', () => {
    expect(parseCacheCoord('37516:abcdef:piggy_xyz')).toEqual({
      kind: 37516,
      pubkey: 'abcdef',
      d: 'piggy_xyz',
    });
  });

  it('returns null on malformed input', () => {
    expect(parseCacheCoord('37516:abcdef')).toBeNull();
    expect(parseCacheCoord('not-a-coord')).toBeNull();
    expect(parseCacheCoord('NaN:abcdef:p')).toBeNull();
  });
});

describe('parseFoundLogEvent', () => {
  const makeFoundLog = (tags: string[][]): VerifiedEvent =>
    ({
      id: 'ev1',
      kind: GC_FOUND_LOG_KIND,
      pubkey: 'finder_pk',
      created_at: 1700,
      tags,
      content: '',
    }) as unknown as VerifiedEvent;

  it('flattens the coord + finder + createdAt from a found-log', () => {
    const log = parseFoundLogEvent(makeFoundLog([['a', '37516:hider:piggy_1']]));
    expect(log).toMatchObject({
      id: 'ev1',
      coord: '37516:hider:piggy_1',
      finderPubkey: 'finder_pk',
      createdAt: 1700,
    });
  });

  it('returns null without an `a` (coord) tag or on the wrong kind', () => {
    expect(parseFoundLogEvent(makeFoundLog([]))).toBeNull();
    expect(parseFoundLogEvent({ ...makeFoundLog([['a', '37516:h:d']]), kind: 1 })).toBeNull();
  });

  it('reads the sat `amount` tag as sats (matches buildFoundLog / parseCache)', () => {
    expect(
      parseFoundLogEvent(
        makeFoundLog([
          ['a', '37516:h:d'],
          ['amount', '21'],
        ]),
      )?.amountSats,
    ).toBe(21);
  });

  it('keeps a genuine 0-sat amount rather than nulling it', () => {
    // `0` is a real claim amount — only missing / non-numeric tags → null.
    expect(
      parseFoundLogEvent(
        makeFoundLog([
          ['a', '37516:h:d'],
          ['amount', '0'],
        ]),
      )?.amountSats,
    ).toBe(0);
  });

  it('nulls a missing or non-numeric amount tag', () => {
    expect(parseFoundLogEvent(makeFoundLog([['a', '37516:h:d']]))?.amountSats).toBeNull();
    expect(
      parseFoundLogEvent(
        makeFoundLog([
          ['a', '37516:h:d'],
          ['amount', 'nope'],
        ]),
      )?.amountSats,
    ).toBeNull();
  });

  it('rejects a negative amount tag (malformed relay data)', () => {
    // buildFoundLog only writes `amount` when sats > 0; a negative value
    // would produce a confusing UI (negative zap pill), so treat it as null.
    expect(
      parseFoundLogEvent(
        makeFoundLog([
          ['a', '37516:h:d'],
          ['amount', '-5'],
        ]),
      )?.amountSats,
    ).toBeNull();
  });

  it('rejects a coord where the kind does not match GC_LISTING_KIND', () => {
    // e.g. a malformed relay event pointing at a different NIP kind.
    expect(parseFoundLogEvent(makeFoundLog([['a', '1:hider:d']]))).toBeNull();
    expect(parseFoundLogEvent(makeFoundLog([['a', 'bad:hider:d']]))).toBeNull();
  });

  it('rejects a coord that is not <kind>:<pubkey>:<d>', () => {
    // Only two parts — missing the d-tag segment.
    expect(parseFoundLogEvent(makeFoundLog([['a', '37516:onlytwo']]))).toBeNull();
    // Non-empty but otherwise garbage.
    expect(parseFoundLogEvent(makeFoundLog([['a', 'notacoord']]))).toBeNull();
  });
});
