import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import { getActivePubkey } from './walletStorageService';
import type { SubmarineSwapResult } from './boltzService';
import { classifySubmarineSwapStatus } from './boltzSwapStatus';
import Toast from '../components/BrandedToast';
import { fireNotification } from './notificationService';
import { t } from '../i18n';

/** Public funding instructions only. Refund keys stay in SecureStore. */
export interface ExternalSwapState {
  id: string;
  address: string;
  expectedAmount: number;
  timeoutBlockHeight: number;
  sourceWalletId: string;
  destinationWalletId: string;
  ownerPubkey?: string;
  invoiceSats: number;
  invoice: string;
  createdAt: number;
  status: string;
}
const key = (owner?: string) => perAccountKey('external_swaps_v1', owner);
let writes: Promise<unknown> = Promise.resolve();

async function read(owner?: string): Promise<ExternalSwapState[]> {
  const raw = await AsyncStorage.getItem(key(owner));
  return raw ? (JSON.parse(raw) as ExternalSwapState[]) : [];
}

/** Serialize read/modify/write so recovery and a live watcher cannot lose records.
 * Terminal outcomes never regress to an older pending response. */
export function saveExternalSwap(input: ExternalSwapState): Promise<void> {
  // Recovery passes a richer SecureStore record: whitelist public fields so
  // no refund key or script tree can ever leak into AsyncStorage.
  const state: ExternalSwapState = {
    id: input.id,
    address: input.address,
    expectedAmount: input.expectedAmount,
    timeoutBlockHeight: input.timeoutBlockHeight,
    sourceWalletId: input.sourceWalletId,
    destinationWalletId: input.destinationWalletId,
    ownerPubkey: input.ownerPubkey,
    invoiceSats: input.invoiceSats,
    invoice: input.invoice,
    createdAt: input.createdAt,
    status: input.status,
  };
  const write = writes
    .catch(() => {})
    .then(async () => {
      const records = await read(state.ownerPubkey);
      const index = records.findIndex((record) => record.id === state.id);
      const previous = records[index];
      if (
        previous &&
        ['complete', 'failed'].includes(classifySubmarineSwapStatus(previous.status)) &&
        !['complete', 'failed'].includes(classifySubmarineSwapStatus(state.status))
      )
        return;
      if (index < 0) records.unshift(state);
      else records[index] = state;
      await AsyncStorage.setItem(key(state.ownerPubkey), JSON.stringify(records));
      if (
        classifySubmarineSwapStatus(previous?.status) !== 'complete' &&
        classifySubmarineSwapStatus(state.status) === 'complete' &&
        state.ownerPubkey === (getActivePubkey() ?? undefined)
      ) {
        const title = t('externalSwap.complete');
        const body = t('externalSwap.delivered');
        Toast.show({ type: 'success', text1: title, text2: body });
        void fireNotification({ kind: 'swap', title, body });
      }
    });
  writes = write;
  return write;
}

export async function loadExternalSwaps(
  source: string,
  dest: string,
): Promise<ExternalSwapState[]> {
  await writes.catch(() => {});
  return (await read(getActivePubkey() ?? undefined)).filter(
    (record) => record.sourceWalletId === source && record.destinationWalletId === dest,
  );
}
export function externalSwapState(
  swap: SubmarineSwapResult,
  source: string,
  dest: string,
  invoiceSats: number,
  invoice: string,
  ownerPubkey?: string,
): ExternalSwapState {
  return {
    id: swap.id,
    address: swap.address,
    expectedAmount: swap.expectedAmount,
    timeoutBlockHeight: swap.timeoutBlockHeight,
    sourceWalletId: source,
    destinationWalletId: dest,
    invoiceSats,
    invoice,
    ownerPubkey,
    createdAt: Date.now(),
    status: 'swap.created',
  };
}
