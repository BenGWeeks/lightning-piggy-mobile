// Marmot app events that are live state, not conversation (#1300): kinds in
// NIP-01's ephemeral range (20000–29999) — today the live-location coordinate
// update (kind 20069). They still travel as ordinary kind-445 MLS application
// messages (the spec allows only kind 445 for group traffic), but receivers
// apply them as a marker move and keep nothing:
//   - never written to the durable rumor history, whose newest-500 window is
//     the crash-safety net for real messages (an 8 h share can emit ~960);
//   - never held in the delivered-dedupe cache (a duplicate update is
//     harmless — the update store drops anything not newer).

import { makeKeyValueRumorHistoryFactory } from '@internet-privacy/marmot-ts/extra';
import type { GenericKeyValueStore } from '@internet-privacy/marmot-ts/utils';
import type { Rumor } from 'applesauce-common/helpers/gift-wrap';
import { isTransientMarmotKind } from './marmotKinds';

export { isTransientMarmotKind };

/** Wrap a group's history store so transient rumors are never persisted. */
export function skipTransientRumors<T extends { kind: number }>(
  store: GenericKeyValueStore<T>,
): GenericKeyValueStore<T> {
  return {
    ...store,
    setItem: (key, value) =>
      isTransientMarmotKind(value.kind) ? Promise.resolve(value) : store.setItem(key, value),
  };
}

/** marmot-ts's key-value rumor history, minus transient rumors. */
export const transientFreeHistoryFactory = (
  storeFor: (groupId: Uint8Array) => GenericKeyValueStore<Rumor>,
) => makeKeyValueRumorHistoryFactory((groupId) => skipTransientRumors(storeFor(groupId)));
