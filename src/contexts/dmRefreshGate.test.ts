import {
  isColdStartRefresh,
  shouldSkipForFreshness,
  shouldStampCursor,
  bypassesFreshnessTtl,
  shouldBypassSkipSet,
  shouldDropK4Since,
} from './dmRefreshGate';
import { DM_INBOX_REFRESH_TTL_MS } from './nostrDmCache';

describe('dmRefreshGate', () => {
  describe('isColdStartRefresh', () => {
    it('is true before any refresh has completed (cursor at 0)', () => {
      expect(isColdStartRefresh(0)).toBe(true);
    });

    it('is false once a refresh has stamped the cursor', () => {
      expect(isColdStartRefresh(1234.5)).toBe(false);
    });
  });

  describe('shouldStampCursor', () => {
    it('stamps when the refresh completed (not aborted)', () => {
      expect(shouldStampCursor(false)).toBe(true);
    });

    it('does NOT stamp when the refresh was aborted', () => {
      // The load-bearing case: an aborted refresh must leave the cursor at 0
      // so the NEXT refresh still reports isColdStart === true and takes
      // #788's macro-task yield path.
      expect(shouldStampCursor(true)).toBe(false);
    });
  });

  describe('shouldSkipForFreshness', () => {
    it('never skips a forced refresh, even within the TTL', () => {
      expect(shouldSkipForFreshness(1000, true, 1000 + 1)).toBe(false);
    });

    it('does not skip when no refresh has completed (cursor at 0)', () => {
      expect(shouldSkipForFreshness(0, false, 5_000)).toBe(false);
    });

    it('skips a non-forced refresh inside the TTL window', () => {
      const last = 10_000;
      const now = last + DM_INBOX_REFRESH_TTL_MS - 1;
      expect(shouldSkipForFreshness(last, false, now)).toBe(true);
    });

    it('does not skip once the TTL window has elapsed', () => {
      const last = 10_000;
      const now = last + DM_INBOX_REFRESH_TTL_MS + 1;
      expect(shouldSkipForFreshness(last, false, now)).toBe(false);
    });
  });

  describe('bypassesFreshnessTtl', () => {
    it('bypasses for a user force (pull-to-refresh)', () => {
      expect(bypassesFreshnessTtl({ force: true })).toBe(true);
    });

    it('bypasses for the cold-start backfill — it fires right after the first pass stamps the cursor', () => {
      expect(bypassesFreshnessTtl({ backfill: true })).toBe(true);
    });

    it('does not bypass a default focus refresh', () => {
      expect(bypassesFreshnessTtl(undefined)).toBe(false);
      expect(bypassesFreshnessTtl({})).toBe(false);
      expect(bypassesFreshnessTtl({ includeNonFollows: true })).toBe(false);
    });
  });

  describe('shouldBypassSkipSet (regression for #846)', () => {
    it('bypasses for a user force so newly-followed contacts re-evaluate (#743)', () => {
      expect(shouldBypassSkipSet({ force: true })).toBe(true);
    });

    it('bypasses when the follow gate is off (includeNonFollows, #744)', () => {
      expect(shouldBypassSkipSet({ includeNonFollows: true })).toBe(true);
    });

    it('does NOT bypass for the cold-start backfill — the every-cold-start decrypt sweep (#846)', () => {
      expect(shouldBypassSkipSet({ backfill: true })).toBe(false);
    });

    it('does not bypass a default refresh', () => {
      expect(shouldBypassSkipSet(undefined)).toBe(false);
      expect(shouldBypassSkipSet({})).toBe(false);
    });
  });

  describe('shouldDropK4Since (regression for #846)', () => {
    it('drops the floor for a non-cold user force (re-fetch older kind-4 after a follow toggle)', () => {
      expect(shouldDropK4Since({ force: true }, false)).toBe(true);
    });

    it('keeps the floor on cold start even under force (#751)', () => {
      expect(shouldDropK4Since({ force: true }, true)).toBe(false);
    });

    it('keeps the floor for the backfill — the NIP-04 plaintext cache is memory-only (#846)', () => {
      expect(shouldDropK4Since({ backfill: true }, false)).toBe(false);
    });

    it('keeps the floor for default refreshes', () => {
      expect(shouldDropK4Since(undefined, false)).toBe(false);
      expect(shouldDropK4Since({}, true)).toBe(false);
    });
  });

  describe('cold-start survives an aborted refresh (regression for #788)', () => {
    it('keeps the next refresh a cold start when the prior one aborted', () => {
      // Simulate the cursor the hook holds.
      let cursor = 0;

      // First (cold) refresh starts: it IS a cold start.
      expect(isColdStartRefresh(cursor)).toBe(true);

      // ...but it gets aborted mid-decrypt (e.g. the spurious enforce-flip
      // refresh, now removed, used to abort it). The hook must not stamp.
      const aborted = true;
      if (shouldStampCursor(aborted)) cursor = 999; // would-be stamp
      expect(cursor).toBe(0);

      // The retry therefore still sees a cold start and takes the yield path.
      expect(isColdStartRefresh(cursor)).toBe(true);

      // A clean completion finally stamps the cursor.
      if (shouldStampCursor(false)) cursor = 12_345;
      expect(isColdStartRefresh(cursor)).toBe(false);
    });
  });
});
