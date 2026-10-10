import { finalizeEvent, generateSecretKey, type Event as NostrEvent } from 'nostr-tools';

import {
  MarmotUnusableKeyPackageError,
  isRetiredKeyPackagePlaceholder,
  newestKeyPackagePerSlot,
  pickKeyPackage,
} from './marmotKeyPackages';

const sk = generateSecretKey();
const ev = (d: string, created_at: number, content = 'kp', tags: string[][] = [['i', 'ab']]) =>
  finalizeEvent({ kind: 30443, created_at, content, tags: [['d', d], ...tags] }, sk) as NostrEvent;

describe('marmotKeyPackages', () => {
  it('recognises the placeholder a signed-out install leaves in its slot', () => {
    expect(isRetiredKeyPackagePlaceholder(ev('a', 1, ''))).toBe(true);
    expect(isRetiredKeyPackagePlaceholder(ev('a', 1, 'kp', []))).toBe(true);
    expect(isRetiredKeyPackagePlaceholder(ev('a', 1))).toBe(false);
  });

  it('drops a retired slot entirely, even if an older key package lingers in it', () => {
    const live = ev('live', 5);
    const retired = [ev('gone', 3), ev('gone', 9, '', [])];
    expect(newestKeyPackagePerSlot([...retired, live]).map((e) => e.id)).toEqual([live.id]);
  });

  it('breaks a same-second tie within a slot by the lower event id', () => {
    const [x, y] = [ev('s', 7, 'one'), ev('s', 7, 'two')];
    const lower = x.id < y.id ? x : y;
    expect(newestKeyPackagePerSlot([x, y])).toEqual([lower]);
    expect(newestKeyPackagePerSlot([y, x])).toEqual([lower]);
  });

  it('pickKeyPackage: only retired slots means "no key package", not "unusable"', () => {
    expect(pickKeyPackage('peer', [ev('gone', 9, '', [['d', 'gone']])])).toBeNull();
    // A real (here: undecodable) key package still reports as unusable.
    expect(() => pickKeyPackage('peer', [ev('live', 9)])).toThrow(MarmotUnusableKeyPackageError);
  });
});
