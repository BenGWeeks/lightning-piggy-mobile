import { liveLocationBubbleText } from './liveLocationBubbleText';

const now = 1_760_000_000_000;
const text = (over: Partial<Parameters<typeof liveLocationBubbleText>[0]>) =>
  liveLocationBubbleText({
    status: 'active',
    fromMe: false,
    latest: undefined,
    remainingMs: null,
    now,
    ...over,
  });

it('titles by status and side', () => {
  expect(text({ fromMe: true }).title).toBe('Sharing live location');
  expect(text({}).title).toBe('Live location');
  expect(text({ status: 'paused' }).title).toBe('Live location · paused');
  expect(text({ status: 'expired' }).title).toBe('Live location ended');
});

it('describes freshness', () => {
  expect(text({}).subtitle).toBe('Waiting for first update…');
  expect(text({ latest: { ts: now - 12_000 } }).subtitle).toBe('Updated 12s ago');
  expect(text({ latest: { ts: now - 125_000 } }).subtitle).toBe('Updated 2m ago');
  expect(text({ status: 'ended' }).subtitle).toBeNull();
});

it('counts down, and stops counting once ended', () => {
  expect(text({ remainingMs: 14 * 60_000 + 1 }).remaining).toBe('15 min left');
  expect(text({ remainingMs: 2 * 3_600_000 }).remaining).toBe('2h left');
  expect(text({ remainingMs: 90 * 60_000 }).remaining).toBe('1h 30m left');
  expect(text({ remainingMs: 0 }).remaining).toBe('Ending…');
  expect(text({ status: 'ended', remainingMs: 5 }).remaining).toBeNull();
});
