import { relayPublishSummary } from './relayPublishSummary';
it('counts own accepts and shared indexers; only real own failures are problems', () => {
  const results = [
    { url: 'wss://own.example/', ok: true },
    { url: 'wss://purplepag.es', ok: true },
    { url: 'wss://user.kindpag.es', ok: false, skipped: 'kind' as const },
    { url: 'wss://nos.lol', ok: false, skipped: 'unhealthy' as const },
    { url: 'wss://other-default.example', ok: false, message: 'timed out' },
    { url: 'wss://own-failed.example', ok: false, message: 'payment required' },
  ];
  const summary = relayPublishSummary(results, [
    'wss://OWN.example',
    'wss://own-failed.example',
    'wss://nos.lol',
  ]);
  expect(summary.sent).toBe(1);
  expect(summary.shared).toBe(1);
  expect(summary.problems).toEqual([results[5]]);
  expect(summary.skipped).toEqual(results.slice(2, 5));
});
it('leaves auxiliary rejections in Details without labelling them as deliberate skips or own problems', () => {
  const summary = relayPublishSummary(
    [{ url: 'wss://purplepag.es', ok: false, message: 'rate-limited: later' }],
    ['wss://own.example'],
  );
  expect(summary.problems).toEqual([]);
  expect(summary.skipped).toEqual([]);
});
it('preserves case-sensitive URL paths when deciding whether a failed relay is owned', () => {
  const result = { url: 'wss://relay.example/Other', ok: false, message: 'rejected' };
  expect(relayPublishSummary([result], ['wss://relay.example/other']).problems).toEqual([]);
});
