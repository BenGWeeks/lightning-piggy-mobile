// Tests for the found-log fan-out on the in-app nostr event bus (#760).
// The bus is a tiny synchronous pub/sub; we assert delivery, scoping by
// the (cacheCoord, logId) payload, unsubscribe, and the throw-isolation
// guarantee (one bad listener must not starve the others).

import { notifyFoundLog, subscribeFoundLogEvents } from './nostrEventBus';

const COORD = '37516:owner:my-piggy-d';
const LOG_ID = 'f'.repeat(64);

it('delivers the coord + log id to a subscribed listener', () => {
  const listener = jest.fn();
  const unsub = subscribeFoundLogEvents(listener);
  notifyFoundLog(COORD, LOG_ID);
  expect(listener).toHaveBeenCalledWith(COORD, LOG_ID);
  unsub();
});

it('stops delivering after unsubscribe', () => {
  const listener = jest.fn();
  const unsub = subscribeFoundLogEvents(listener);
  unsub();
  notifyFoundLog(COORD, LOG_ID);
  expect(listener).not.toHaveBeenCalled();
});

it('fans out to every subscriber and isolates a throwing one', () => {
  const good = jest.fn();
  const bad = jest.fn(() => {
    throw new Error('listener blew up');
  });
  const unsubBad = subscribeFoundLogEvents(bad);
  const unsubGood = subscribeFoundLogEvents(good);
  // The bus warns (dev) on a throwing listener — silence the expected noise.
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // A throwing listener must not prevent the others from firing.
  expect(() => notifyFoundLog(COORD, LOG_ID)).not.toThrow();
  expect(bad).toHaveBeenCalledTimes(1);
  expect(good).toHaveBeenCalledTimes(1);
  warnSpy.mockRestore();
  unsubBad();
  unsubGood();
});
