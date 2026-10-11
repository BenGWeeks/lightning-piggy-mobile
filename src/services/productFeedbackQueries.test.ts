import { finalizeEvent, type Event as NostrEvent, type Filter } from 'nostr-tools';
import {
  REVIEWS_LIMIT,
  queryCommentDeletions,
  queryCommentEvents,
  queryReviewDeletions,
  queryReviewEvents,
} from './productFeedbackQueries';
import { querySyncAbortable } from './relayQuery';
import { REVIEW_KIND, productReviewCoord } from '../utils/productReviews';
import { COMMENT_KIND, DEFAULT_COMMENTS_LIMIT } from '../utils/productComments';
import { DELETION_KIND } from '../utils/nip09';

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));

const query = querySyncAbortable as jest.Mock;
const RELAYS = ['wss://relay.example'];
const MERCHANT = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const COORD = productReviewCoord(MERCHANT, 'piggy-bank');
const ROOT: NostrEvent = {
  id: '',
  pubkey: MERCHANT,
  kind: 30402,
  created_at: 0,
  tags: [['d', 'piggy-bank']],
  content: '',
  sig: '',
};
const ev = (over: Partial<NostrEvent>): NostrEvent => ({
  id: 'f'.repeat(64),
  pubkey: ALICE,
  kind: COMMENT_KIND,
  created_at: 100,
  tags: [],
  content: '',
  sig: '',
  ...over,
});
const filters = () => query.mock.calls.map((c) => c[2] as Filter);

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue([]);
});

describe('queryReviewEvents', () => {
  const signal = new AbortController().signal;

  it('is bounded by limit, with no since on the first load', async () => {
    await queryReviewEvents(RELAYS, COORD, { signal });
    expect(filters()).toEqual([{ kinds: [REVIEW_KIND], '#d': [COORD], limit: REVIEWS_LIMIT }]);
    expect(query.mock.calls[0][3]).toMatchObject({ rejectOnAllRelaysFailure: true, signal });
  });

  it('adds since + the caller deadline on a refresh', async () => {
    await queryReviewEvents(RELAYS, COORD, { signal, since: 1234, maxWait: 3000 });
    expect(filters()[0]).toMatchObject({ since: 1234, limit: REVIEWS_LIMIT });
    expect(query.mock.calls[0][3]).toMatchObject({ maxWait: 3000 });
  });
});

describe('verify', () => {
  const key = new Uint8Array(32).fill(3);
  const signed = finalizeEvent(
    { kind: REVIEW_KIND, created_at: 100, content: '', tags: [['d', COORD]] },
    key,
  );
  // Rebuilt from JSON: object spread would copy nostr-tools' memoised
  // "verified" Symbol marker along with the fields.
  const forged = { ...JSON.parse(JSON.stringify(signed)), content: 'tampered' } as NostrEvent;

  it('drops events with a bad signature when asked', async () => {
    query.mockResolvedValue([signed, forged]);
    const got = await queryReviewEvents(RELAYS, COORD, {
      signal: new AbortController().signal,
      verify: true,
    });
    expect(got).toEqual([signed]);
  });

  it('leaves the pool-verified first load alone by default', async () => {
    query.mockResolvedValue([signed, forged]);
    const got = await queryReviewEvents(RELAYS, COORD, { signal: new AbortController().signal });
    expect(got).toHaveLength(2);
  });
});

describe('queryCommentEvents', () => {
  it('keeps only comments rooted on this product', async () => {
    const ours = ev({ id: '1'.repeat(64), tags: [['A', `30402:${MERCHANT}:piggy-bank`]] });
    const other = ev({ id: '2'.repeat(64), tags: [['A', `30402:${MERCHANT}:other`]] });
    query.mockResolvedValue([ours, other]);
    const got = await queryCommentEvents(RELAYS, ROOT, {
      signal: new AbortController().signal,
      since: 50,
    });
    expect(got).toEqual([ours]);
    expect(filters()[0]).toMatchObject({
      kinds: [COMMENT_KIND],
      '#A': [`30402:${MERCHANT}:piggy-bank`],
      limit: DEFAULT_COMMENTS_LIMIT,
      since: 50,
    });
  });
});

describe('deletion lookups', () => {
  it('asks for review kind-5s by address and id, author-scoped, with since', async () => {
    const r = ev({ kind: REVIEW_KIND, tags: [['d', COORD]] });
    query.mockResolvedValue([ev({ kind: DELETION_KIND }), ev({ kind: COMMENT_KIND })]);
    const dels = await queryReviewDeletions(RELAYS, [r], {
      signal: new AbortController().signal,
      since: 77,
    });
    expect(dels.every((d) => d.kind === DELETION_KIND)).toBe(true);
    expect(filters()).toEqual([
      {
        kinds: [DELETION_KIND],
        authors: [ALICE],
        limit: 2,
        '#a': [`${REVIEW_KIND}:${ALICE}:${COORD}`],
        since: 77,
      },
      { kinds: [DELETION_KIND], authors: [ALICE], limit: 2, '#e': [r.id], since: 77 },
    ]);
  });

  it('asks for comment kind-5s by id only', async () => {
    await queryCommentDeletions(RELAYS, [ev({})], { signal: new AbortController().signal });
    expect(filters()).toEqual([
      { kinds: [DELETION_KIND], authors: [ALICE], limit: 2, '#e': ['f'.repeat(64)] },
    ]);
  });
});
