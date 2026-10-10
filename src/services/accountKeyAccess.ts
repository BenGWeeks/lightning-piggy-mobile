// Read-side access to an account's secret key for the Back up your key
// screen (#1223): device-auth gate + the SecureStore read.
//
// Rules for callers: never log, toast, navigate with, or persist the
// returned nsec. Hold it in component state only while the screen is
// focused and drop it on blur / unmount.
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { loadIdentities } from './identitiesStore';
import { NSEC_KEY, PUBKEY_KEY } from '../contexts/nostrAuthKeys';

/**
 * The nsec for `pubkey`, or null if this phone doesn't hold one (Amber /
 * NIP-46 accounts, or an unknown pubkey). Looks in the multi-account
 * registry first, then falls back to the legacy single-identity slot when
 * it belongs to the same pubkey.
 */
export async function loadAccountNsec(pubkey: string): Promise<string | null> {
  const blob = await loadIdentities();
  const entry = blob.identities.find((i) => i.pubkey === pubkey);
  if (entry?.signerType === 'nsec' && entry.nsec) return entry.nsec;
  if (entry && entry.signerType !== 'nsec') return null;
  const legacyPubkey = await SecureStore.getItemAsync(PUBKEY_KEY);
  if (legacyPubkey !== pubkey) return null;
  return SecureStore.getItemAsync(NSEC_KEY);
}

export type KeyRevealGate = 'device-auth' | 'confirm-only';

/**
 * How to gate the reveal: real device authentication when the phone has a
 * screen lock or biometrics enrolled, otherwise an explicit in-app
 * confirmation (we can't prove who's holding an unlocked-by-default phone).
 */
export async function keyRevealGate(): Promise<KeyRevealGate> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'confirm-only' : 'device-auth';
  } catch {
    return 'confirm-only';
  }
}

/** Prompt for biometrics / PIN / pattern. Resolves true on success. */
export async function authenticateForKeyReveal(prompt: {
  promptMessage: string;
  cancelLabel: string;
}): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt.promptMessage,
      cancelLabel: prompt.cancelLabel,
      // Allow PIN / pattern / passcode as well as biometrics.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
