// Sign-out entry point for removing an account's Marmot invitation keys from
// relays (#1204): picks the signer, stops the account's Marmot session so
// nothing republishes, retires the key packages, and keeps the user informed
// — a remote signer (Amber / NIP-46) has up to two prompts to answer first.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools';

import Toast from '../components/BrandedToast';
import { RELAY_LIST_CACHE_KEY_BASE } from '../contexts/nostrCacheKeys';
import { t } from '../i18n';
import type { SignerType } from '../types/nostr';
import type { StoredIdentity } from './identitiesStore';
import {
  retireMarmotKeyPackages,
  type RetireOutcome,
  type RetireSigner,
} from './marmotKeyPackageRetire';
import { quiesceMarmotSession } from './marmotSession';
import { createMarmotSigner } from './marmotSigner';
import { getActiveConnection } from './nostrConnectService';
import { decodeNsec } from './nostrService';
import { perAccountKey } from './perAccountStorage';

/**
 * The signer that can sign for `owner` right now, or null. A NIP-46 signer
 * is only usable while it is THIS account's live connection — otherwise the
 * request would go to another account's bunker (and wait out its timeout).
 */
function signerFor(owner: string, signerType: SignerType | null, nsec?: string) {
  if (nsec) {
    const sk = decodeNsec(nsec).secretKey;
    return { sign: (async (tpl) => finalizeEvent(tpl, sk)) as RetireSigner, remote: false };
  }
  if (!signerType) return null;
  if (signerType === 'nip46' && getActiveConnection()?.userPubkey !== owner) return null;
  // The active nsec account signs with its SecureStore key.
  const signer = createMarmotSigner(owner, signerType);
  return {
    sign: (async (tpl) => (await signer.signEvent(tpl)) as NostrEvent) as RetireSigner,
    remote: signerType !== 'nsec',
  };
}

/** `owner`'s cached NIP-65 write relays (still present: sign-out runs before the wipe). */
async function cachedWriteRelays(owner: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, owner));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((r) => typeof r?.url === 'string' && r.write === true).map((r) => r.url)
      : [];
  } catch {
    return [];
  }
}

export async function retireInvitationKeys(args: {
  owner: string;
  signerType: SignerType | null;
  /** bech32 nsec of a non-active nsec account. */
  nsec?: string;
}): Promise<RetireOutcome> {
  const { owner, signerType, nsec } = args;
  const signer = signerFor(owner, signerType, nsec);
  await quiesceMarmotSession(owner).catch(() => undefined);
  let showedProgress = false;
  const outcome = await retireMarmotKeyPackages({
    owner,
    sign: signer?.sign ?? null,
    // Plus, inside: the relays each key package was published to.
    relays: await cachedWriteRelays(owner),
    onBeforeSign: () => {
      if (!signer?.remote) return;
      showedProgress = true;
      Toast.show({
        type: 'info',
        text1: t('marmotInvitationKeys.removingTitle'),
        text2: t('marmotInvitationKeys.removingBody'),
        autoHide: false,
      });
    },
  });
  if (showedProgress) Toast.hide();
  if (outcome === 'failed') {
    Toast.show({
      type: 'info',
      text1: t('marmotInvitationKeys.notRemovedTitle'),
      text2: t('marmotInvitationKeys.notRemovedBody'),
    });
  }
  return outcome;
}

/** Resolve a stored (possibly inactive) identity without switching accounts. */
export function retireStoredInvitationKeys(owner: string, identities: StoredIdentity[]) {
  const identity = identities.find((item) => item.pubkey === owner);
  return retireInvitationKeys({
    owner,
    signerType: identity?.signerType ?? null,
    nsec: identity?.nsec,
  });
}
