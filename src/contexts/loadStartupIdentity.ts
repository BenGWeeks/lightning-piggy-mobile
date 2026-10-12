import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import { loadIdentities, type StoredIdentity } from '../services/identitiesStore';
import { NSEC_KEY, PUBKEY_KEY, SIGNER_TYPE_KEY } from './nostrAuthKeys';
import { restoreNip46Session } from './useNip46Login';
import { perfLog } from '../utils/perfLog';

/** Restore startup identity in the original registry → signer → key order. */
export async function loadStartupIdentity(setIdentities: (identities: StoredIdentity[]) => void) {
  perfLog('identity/SecureStore load start');
  try {
    const blob = await loadIdentities();
    setIdentities(blob.identities);

    const storedSignerType = await SecureStore.getItemAsync(SIGNER_TYPE_KEY);
    let pk: string | null = null;

    let pendingNsec: string | null = null;
    if (storedSignerType === 'nsec') {
      const storedNsec = await SecureStore.getItemAsync(NSEC_KEY);
      if (storedNsec) {
        perfLog('decodeNsec start');
        try {
          pk = nostrService.decodeNsec(storedNsec).pubkey;
        } finally {
          perfLog('decodeNsec end');
        }
        pendingNsec = storedNsec;
      }
    } else if (storedSignerType === 'amber') {
      const storedPubkey = await SecureStore.getItemAsync(PUBKEY_KEY);
      if (storedPubkey) {
        pk = storedPubkey;
      }
    } else if (storedSignerType === 'nip46') {
      // Restore the persisted bunker connection (see useNip46Login).
      pk = await restoreNip46Session();
    }

    return { blob, storedSignerType, pk, pendingNsec };
  } finally {
    perfLog('identity/SecureStore load end');
  }
}
