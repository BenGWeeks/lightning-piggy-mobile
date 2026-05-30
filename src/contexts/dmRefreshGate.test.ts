import { isColdStartRefresh, shouldSkipForFreshness, shouldStampCursor } from './dmRefreshGate';
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
