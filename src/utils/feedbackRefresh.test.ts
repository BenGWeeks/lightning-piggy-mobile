import type { Event as NostrEvent } from 'nostr-tools';
import { REFRESH_SINCE_SLACK_SECS, mergeFeedback, refreshSince } from './feedbackRefresh';
import {
  REVIEW_KIND,
  parseReviewEvent,
  productReviewCoord,
  visibleReviews,
} from './productReviews';
import { COMMENT_KIND } from './productComments';
import { DELETION_KIND } from './nip09';

const MERCHANT = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const COORD = productReviewCoord(MERCHANT, 'piggy-bank');

let seq = 0;
const id = () => (seq++).toString(16).padStart(64, '0');

const review = (pubkey: string, createdAt: number, rating = '0.8'): NostrEvent => ({
  id: id(),
  pubkey,
  kind: REVIEW_KIND,
  created_at: createdAt,
  tags: [
    ['d', COORD],
    ['rating', rating, 'thumb'],
  ],
  content: `review at ${createdAt}`,
  sig: '',
});

const comment = (pubkey: string, createdAt: number): NostrEvent => ({
  id: id(),
  pubkey,
  kind: COMMENT_KIND,
  created_at: createdAt,
  tags: [['A', `30402:${MERCHANT}:piggy-bank`]],
  content: 'hi',
  sig: '',
});

const deletion = (pubkey: string, createdAt: number, tags: string[][]): NostrEvent => ({
  id: id(),
  pubkey,
  kind: DELETION_KIND,
  created_at: createdAt,
  tags,
  content: '',
  sig: '',
});

const isReview = (e: NostrEvent) => parseReviewEvent(e, COORD) !== null;
const ids = (events: NostrEvent[]) => events.map((e) => e.id).sort();

describe('refreshSince', () => {
  it('is undefined when nothing is loaded', () => {
    expect(refreshSince([])).toBeUndefined();
  });

  it('is the newest created_at minus the slack', () => {
    const events = [review(ALICE, 5000), review(BOB, 9000)];
    expect(refreshSince(events, 10_000)).toBe(9000 - REFRESH_SINCE_SLACK_SECS);
  });

  it('caps a future-dated event at now', () => {
    expect(refreshSince([review(ALICE, 99_999)], 10_000)).toBe(10_000 - REFRESH_SINCE_SLACK_SECS);
  });

  it('never goes below zero', () => {
    expect(refreshSince([review(ALICE, 5)], 10_000)).toBe(0);
  });
});

describe('mergeFeedback', () => {
  it('adds a new review to what is loaded', () => {
    const alice = review(ALICE, 100);
    const bob = review(BOB, 200);
    const merged = mergeFeedback(
      { events: [alice], deletions: [] },
      { events: [bob], deletions: [] },
      isReview,
    );
    expect(ids(merged.events)).toEqual(ids([alice, bob]));
    expect(visibleReviews(merged.events, merged.deletions, COORD)).toHaveLength(2);
  });

  it('de-duplicates by id (the since-window overlap)', () => {
    const alice = review(ALICE, 100);
    const merged = mergeFeedback(
      { events: [alice], deletions: [] },
      { events: [alice], deletions: [] },
      isReview,
    );
    expect(merged.events).toEqual([alice]);
  });

  it('replaces an edited review with its newer version by address', () => {
    const original = review(ALICE, 100, '0.4');
    const edited = review(ALICE, 300, '1');
    const merged = mergeFeedback(
      { events: [original], deletions: [] },
      { events: [edited], deletions: [] },
      isReview,
    );
    expect(merged.events).toEqual([edited]);
    expect(visibleReviews(merged.events, merged.deletions, COORD)[0].stars).toBe(5);
  });

  it('keeps the newer version when an older copy arrives late', () => {
    const edited = review(ALICE, 300);
    const stale = review(ALICE, 100);
    const merged = mergeFeedback(
      { events: [edited], deletions: [] },
      { events: [stale], deletions: [] },
      isReview,
    );
    expect(merged.events).toEqual([edited]);
  });

  it('does not let a newer malformed review displace the valid one', () => {
    const valid = review(ALICE, 100);
    const malformed = review(ALICE, 300, 'not-a-number');
    const merged = mergeFeedback(
      { events: [valid], deletions: [] },
      { events: [malformed], deletions: [] },
      isReview,
    );
    expect(visibleReviews(merged.events, merged.deletions, COORD).map((r) => r.id)).toEqual([
      valid.id,
    ]);
  });

  it('removes a review its author deleted by address, and keeps the kind-5', () => {
    const alice = review(ALICE, 100);
    const del = deletion(ALICE, 200, [['a', `${REVIEW_KIND}:${ALICE}:${COORD}`]]);
    const merged = mergeFeedback(
      { events: [alice], deletions: [] },
      { events: [], deletions: [del] },
      isReview,
    );
    expect(merged.events).toEqual([]);
    expect(merged.deletions).toEqual([del]);
  });

  it('removes an edited review deleted by id without resurfacing the older version', () => {
    const original = review(ALICE, 100);
    const edited = review(ALICE, 300);
    const del = deletion(ALICE, 400, [['e', edited.id]]);
    const merged = mergeFeedback(
      { events: [original], deletions: [] },
      { events: [edited], deletions: [del] },
      isReview,
    );
    expect(merged.events).toEqual([]);
  });

  it('removes a deleted comment and ignores a kind-5 from someone else', () => {
    const mine = comment(ALICE, 100);
    const theirs = comment(BOB, 150);
    const fresh = comment(BOB, 250);
    const merged = mergeFeedback(
      { events: [mine, theirs], deletions: [] },
      {
        events: [fresh],
        deletions: [
          deletion(ALICE, 300, [['e', mine.id]]),
          deletion(ALICE, 300, [['e', theirs.id]]),
        ],
      },
    );
    expect(ids(merged.events)).toEqual(ids([theirs, fresh]));
  });
});
