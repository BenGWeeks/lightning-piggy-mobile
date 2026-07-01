import {
  INITIAL_PAGE_SIZE,
  PAGE_SIZE,
  buildTransactionRows,
  hasMoreTransactions,
  nextPage,
  sortTransactions,
  txKey,
  visibleCountForPages,
  windowTransactions,
} from './transactionPagination';
import type { WalletTransaction } from '../types/wallet';

const tx = (over: Partial<WalletTransaction> = {}): WalletTransaction =>
  ({ type: 'incoming', amount: 1, ...over }) as WalletTransaction;

// A settled-at timestamp `n` days before a fixed reference, in seconds.
const REF = Math.floor(new Date('2026-06-30T12:00:00Z').getTime() / 1000);
const daysAgo = (n: number): number => REF - n * 86_400;

const makeMany = (count: number): WalletTransaction[] =>
  Array.from({ length: count }, (_, i) =>
    tx({ paymentHash: `h${i}`, settled_at: REF - i * 60, amount: i + 1 }),
  );

describe('visibleCountForPages', () => {
  it('returns the initial page size for page 1 (and below)', () => {
    expect(visibleCountForPages(0)).toBe(INITIAL_PAGE_SIZE);
    expect(visibleCountForPages(1)).toBe(INITIAL_PAGE_SIZE);
  });

  it('adds a full PAGE_SIZE for each page beyond the first', () => {
    expect(visibleCountForPages(2)).toBe(INITIAL_PAGE_SIZE + PAGE_SIZE);
    expect(visibleCountForPages(3)).toBe(INITIAL_PAGE_SIZE + 2 * PAGE_SIZE);
  });
});

describe('hasMoreTransactions', () => {
  it('is false when everything fits in the visible window', () => {
    expect(hasMoreTransactions(INITIAL_PAGE_SIZE, 1)).toBe(false);
    expect(hasMoreTransactions(5, 1)).toBe(false);
  });

  it('is true when the total exceeds the visible window', () => {
    expect(hasMoreTransactions(INITIAL_PAGE_SIZE + 1, 1)).toBe(true);
  });

  it('becomes false once enough pages are loaded to reveal everything', () => {
    const total = INITIAL_PAGE_SIZE + PAGE_SIZE;
    expect(hasMoreTransactions(total, 1)).toBe(true);
    expect(hasMoreTransactions(total, 2)).toBe(false);
  });
});

describe('nextPage', () => {
  it('advances by one while more remain', () => {
    const total = INITIAL_PAGE_SIZE + 3 * PAGE_SIZE;
    expect(nextPage(total, 1)).toBe(2);
    expect(nextPage(total, 2)).toBe(3);
  });

  it('caps at the current page once everything is revealed (no endless churn)', () => {
    const total = INITIAL_PAGE_SIZE;
    expect(nextPage(total, 1)).toBe(1);
    const total2 = INITIAL_PAGE_SIZE + PAGE_SIZE;
    expect(nextPage(total2, 2)).toBe(2);
  });
});

describe('windowTransactions', () => {
  it('slices to the initial page on page 1', () => {
    const all = makeMany(50);
    expect(windowTransactions(all, 1)).toHaveLength(INITIAL_PAGE_SIZE);
  });

  it('grows by a page each advance, never exceeding the total', () => {
    const all = makeMany(INITIAL_PAGE_SIZE + 5);
    expect(windowTransactions(all, 2)).toHaveLength(INITIAL_PAGE_SIZE + 5);
  });

  it('does not mutate the input', () => {
    const all = makeMany(30);
    const copy = [...all];
    windowTransactions(all, 1);
    expect(all).toEqual(copy);
  });
});

describe('sortTransactions', () => {
  it('puts pending (no timestamp) entries first', () => {
    const pending = tx({ paymentHash: 'p', settled_at: null, created_at: null });
    const settled = tx({ paymentHash: 's', settled_at: REF });
    const sorted = sortTransactions([settled, pending]);
    expect(sorted[0].paymentHash).toBe('p');
  });

  it('sorts settled entries newest first', () => {
    const older = tx({ paymentHash: 'old', settled_at: daysAgo(2) });
    const newer = tx({ paymentHash: 'new', settled_at: daysAgo(0) });
    const sorted = sortTransactions([older, newer]);
    expect(sorted.map((t) => t.paymentHash)).toEqual(['new', 'old']);
  });

  it('does not mutate the input array', () => {
    const all = makeMany(5);
    const copy = [...all];
    sortTransactions(all);
    expect(all).toEqual(copy);
  });

  it('treats a `0` (epoch) timestamp as a real time, not pending', () => {
    // settled_at === 0 is a legitimate epoch timestamp; it must sort as the
    // oldest settled entry (below newer ones) rather than jumping to the top
    // like a pending (null) row.
    const epoch = tx({ paymentHash: 'epoch', settled_at: 0, created_at: 0 });
    const pending = tx({ paymentHash: 'pending', settled_at: null, created_at: null });
    const newer = tx({ paymentHash: 'newer', settled_at: REF });
    const sorted = sortTransactions([epoch, newer, pending]);
    // pending first, then newest settled, then the epoch (oldest) settled.
    expect(sorted.map((t) => t.paymentHash)).toEqual(['pending', 'newer', 'epoch']);
  });

  it('prefers settled_at even when it is `0` (does not fall through to created_at)', () => {
    // settled_at === 0 must win over a non-zero created_at; with `||` the 0
    // would be skipped and created_at used instead, mis-ordering the row.
    const settledAtEpoch = tx({ paymentHash: 'x', settled_at: 0, created_at: REF });
    const other = tx({ paymentHash: 'y', settled_at: daysAgo(1) });
    const sorted = sortTransactions([settledAtEpoch, other]);
    // `other` (day-ago) is newer than the epoch, so it sorts first.
    expect(sorted.map((t) => t.paymentHash)).toEqual(['y', 'x']);
  });
});

describe('txKey', () => {
  it('prefers paymentHash and disambiguates self-payment legs by type', () => {
    const incoming = tx({ type: 'incoming', paymentHash: 'abc' });
    const outgoing = tx({ type: 'outgoing', paymentHash: 'abc' });
    expect(txKey(incoming, 0)).not.toBe(txKey(outgoing, 0));
    expect(txKey(incoming, 0)).toBe('ph:incoming:abc');
  });

  it('falls back through txid, bolt11, then a composite for pending rows', () => {
    expect(txKey(tx({ txid: 't1' }), 0)).toBe('tx:incoming:t1');
    expect(txKey(tx({ bolt11: 'lnbc1' }), 0)).toBe('b11:incoming:lnbc1');
    expect(txKey(tx({ amount: 7 }), 3)).toBe('fb:incoming:pending:7:3');
  });
});

describe('buildTransactionRows', () => {
  const fmt = (ts: number): string => new Date(ts * 1000).toDateString();

  it('emits a day header before each new day group', () => {
    const visible = [
      tx({ paymentHash: 'a', settled_at: daysAgo(0) }),
      tx({ paymentHash: 'b', settled_at: daysAgo(0) }),
      tx({ paymentHash: 'c', settled_at: daysAgo(1) }),
    ];
    const rows = buildTransactionRows(visible, fmt);
    const kinds = rows.map((r) => r.kind);
    // header, tx, tx, header, tx
    expect(kinds).toEqual(['header', 'tx', 'tx', 'header', 'tx']);
  });

  it('groups pending entries under a "Pending" header', () => {
    const visible = [tx({ paymentHash: 'p', settled_at: null, created_at: null })];
    const rows = buildTransactionRows(visible, fmt);
    expect(rows[0]).toMatchObject({ kind: 'header', label: 'Pending' });
  });

  it('produces unique keys across rows', () => {
    const rows = buildTransactionRows(makeMany(10), fmt);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups a `0` (epoch) timestamp under its real day, not "Pending"', () => {
    // settled_at === 0 is a valid epoch timestamp: it must produce a formatted
    // day header (1970-01-01), never the "Pending" bucket.
    const visible = [tx({ paymentHash: 'epoch', settled_at: 0, created_at: 0 })];
    const rows = buildTransactionRows(visible, fmt);
    expect(rows[0]).toMatchObject({ kind: 'header', label: fmt(0) });
    expect((rows[0] as { label: string }).label).not.toBe('Pending');
  });
});
