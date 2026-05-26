import type { VerifiedEvent } from 'nostr-tools';
import { NIP52_TIME_BASED_KIND, parseNip52Event } from './nostrPlacesService';

const sample = (overrides: Partial<VerifiedEvent> = {}): VerifiedEvent =>
  ({
    id: 'evt1',
    pubkey: 'organiser',
    sig: 'sig',
    kind: NIP52_TIME_BASED_KIND,
    created_at: 1700000000,
    content: 'Bitcoin Beers — pints + pleb chat. Newcomers welcome.',
    tags: [
      ['d', 'bitcoin-beers-london-2026-05-10'],
      ['title', 'Bitcoin Beers London'],
      ['start', '1746878400'],
      ['end', '1746889200'],
      ['location', 'The Black Lion, Bayswater'],
      ['g', 'gcpvj0u'],
      ['g', 'gcpvj0'],
      ['g', 'gcpvj'],
      ['t', 'bitcoin'],
      ['t', 'london'],
      ['image', 'https://example.com/event.jpg'],
    ],
    ...overrides,
  }) as VerifiedEvent;

describe('parseNip52Event', () => {
  it('parses the standard NIP-52 kind 31923 fields', () => {
    const e = parseNip52Event(sample());
    expect(e).not.toBeNull();
    expect(e!.coord).toBe(`31923:organiser:bitcoin-beers-london-2026-05-10`);
    expect(e!.title).toBe('Bitcoin Beers London');
    expect(e!.startsAt).toBe(1746878400);
    expect(e!.endsAt).toBe(1746889200);
    expect(e!.location).toBe('The Black Lion, Bayswater');
    expect(e!.imageUrl).toBe('https://example.com/event.jpg');
    expect(e!.hashtags).toEqual(['bitcoin', 'london']);
  });

  it('returns the longest g tag as the canonical geohash', () => {
    expect(parseNip52Event(sample())!.geohash).toBe('gcpvj0u');
  });

  it('returns null on non-31923 events', () => {
    expect(parseNip52Event(sample({ kind: 1 }))).toBeNull();
  });

  it('returns null when the d tag is missing', () => {
    const noD = sample({ tags: [['title', 'Whatever']] });
    expect(parseNip52Event(noD)).toBeNull();
  });

  it('falls back to "Untitled event" when no title/name tag', () => {
    const noTitle = sample({ tags: [['d', 'just-a-d']] });
    const e = parseNip52Event(noTitle);
    expect(e?.title).toBe('Untitled event');
  });

  it('handles events with no end / location / image tags', () => {
    const minimal = sample({
      tags: [
        ['d', 'minimal'],
        ['title', 'Minimal'],
        ['start', '1800000000'],
      ],
    });
    const e = parseNip52Event(minimal);
    expect(e?.endsAt).toBeNull();
    expect(e?.location).toBeNull();
    expect(e?.imageUrl).toBeNull();
    expect(e?.hashtags).toEqual([]);
  });
});
