import type { Event as NostrEvent } from 'nostr-tools';
import {
  COMMENT_KIND,
  addressableCoord,
  buildCommentTags,
  commentFilterForRoot,
  commentRootRef,
  directReplies,
  isTopLevelComment,
  topLevelComments,
} from './productComments';

const MERCHANT = 'a'.repeat(64);
const D_TAG = 'robotechy-lightning-piggy';
const PRODUCT_COORD = `30402:${MERCHANT}:${D_TAG}`; // NOTE: no a: prefix

const product = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: 'prod-id',
    pubkey: MERCHANT,
    kind: 30402,
    tags: [['d', D_TAG]],
    content: '',
    created_at: 1,
    sig: '',
    ...over,
  }) as NostrEvent;

const comment = (tags: string[][], over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id: 'c-id',
    pubkey: 'commenter',
    kind: COMMENT_KIND,
    tags,
    content: '',
    created_at: 1,
    sig: '',
    ...over,
  }) as NostrEvent;

describe('addressableCoord', () => {
  it('builds the bare <kind>:<pubkey>:<d> coordinate', () => {
    expect(addressableCoord(product())).toBe(PRODUCT_COORD);
  });

  it('leaves an empty d segment when absent', () => {
    expect(addressableCoord(product({ tags: [] }))).toBe(`30402:${MERCHANT}:`);
  });
});

describe('commentRootRef', () => {
  it('uses the coordinate for addressable roots and is stable across id changes', () => {
    expect(commentRootRef(product({ id: 'id-v1' }))).toBe(PRODUCT_COORD);
    expect(commentRootRef(product({ id: 'id-v2' }))).toBe(PRODUCT_COORD);
  });

  it('uses the id for a regular event and href for a URL', () => {
    expect(commentRootRef(product({ kind: 1, id: 'note1' }))).toBe('note1');
    expect(commentRootRef(new URL('https://shop.example/x'))).toBe('https://shop.example/x');
  });
});

describe('commentFilterForRoot', () => {
  it('filters kind 1111 by #A for an addressable product root', () => {
    const f = commentFilterForRoot(product());
    expect(f.kinds).toEqual([COMMENT_KIND]);
    expect(f['#A']).toEqual([PRODUCT_COORD]);
    expect(f.limit).toBeUndefined();
  });

  it('passes a numeric limit through', () => {
    expect(commentFilterForRoot(product(), 500).limit).toBe(500);
  });

  it('uses #I for a URL root and #E for a regular event root', () => {
    expect(commentFilterForRoot(new URL('https://shop.example/x'))['#I']).toEqual([
      'https://shop.example/x',
    ]);
    expect(commentFilterForRoot(product({ kind: 1, id: 'note1' }))['#E']).toEqual(['note1']);
  });
});

describe('buildCommentTags + isTopLevelComment', () => {
  it('roots a top-level comment on the product with matching upper/lower tags', () => {
    const tags = buildCommentTags(product());
    expect(tags).toContainEqual(['A', PRODUCT_COORD]);
    expect(tags).toContainEqual(['K', '30402']);
    expect(tags).toContainEqual(['P', MERCHANT]);
    expect(tags).toContainEqual(['a', PRODUCT_COORD]);
    expect(tags).toContainEqual(['k', '30402']);
    expect(tags).toContainEqual(['p', MERCHANT]);
    // A freshly-built top-level comment is recognised as top-level.
    expect(isTopLevelComment(comment(tags), product())).toBe(true);
  });

  it('points the lowercase tags at the parent comment when replying', () => {
    const parent = comment(buildCommentTags(product()), { id: 'parent-id', pubkey: 'alice' });
    const tags = buildCommentTags(product(), parent);
    // Uppercase root scope unchanged.
    expect(tags).toContainEqual(['A', PRODUCT_COORD]);
    // Lowercase parent points at the parent comment (regular event).
    expect(tags).toContainEqual(['e', 'parent-id']);
    expect(tags).toContainEqual(['k', String(COMMENT_KIND)]);
    expect(tags).toContainEqual(['p', 'alice']);
    // A reply is NOT top-level even though its uppercase A points at the product.
    expect(isTopLevelComment(comment(tags), product())).toBe(false);
  });

  it('uses the NIP-73 "web" external-id kind for K/k and href for I/i on a URL root', () => {
    const tags = buildCommentTags(new URL('https://shop.example/x'));
    // NIP-22 + NIP-73: a URL root scopes to the URL (I/i) with the external
    // identity kind "web" (K/k) — the literal string, not the hostname.
    expect(tags).toContainEqual(['I', 'https://shop.example/x']);
    expect(tags).toContainEqual(['K', 'web']);
    // The lowercase parent mirrors the root for a top-level comment.
    expect(tags).toContainEqual(['i', 'https://shop.example/x']);
    expect(tags).toContainEqual(['k', 'web']);
  });
});

describe('topLevelComments + directReplies', () => {
  it('returns only top-level comments, newest-first', () => {
    const t1 = comment(buildCommentTags(product()), { id: 't1', created_at: 10 });
    const t2 = comment(buildCommentTags(product()), { id: 't2', created_at: 20 });
    const reply = comment(buildCommentTags(product(), t1), { id: 'r1', created_at: 30 });
    const tops = topLevelComments([t1, t2, reply], product());
    expect(tops.map((c) => c.id)).toEqual(['t2', 't1']);
  });

  it('returns direct replies of a parent, oldest-first', () => {
    const t1 = comment(buildCommentTags(product()), { id: 't1' });
    const r1 = comment(buildCommentTags(product(), t1), { id: 'r1', created_at: 30 });
    const r2 = comment(buildCommentTags(product(), t1), { id: 'r2', created_at: 20 });
    const replies = directReplies([t1, r1, r2], 't1');
    expect(replies.map((c) => c.id)).toEqual(['r2', 'r1']);
  });
});
