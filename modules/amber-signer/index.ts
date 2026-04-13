import { requireNativeModule, Platform } from 'expo-modules-core';

interface GetPublicKeyResult {
  pubkey: string;
  package: string;
}

interface SignEventResult {
  signature: string;
  event: string;
}

const AmberSigner = Platform.OS === 'android' ? requireNativeModule('AmberSigner') : null;

export async function getPublicKey(): Promise<GetPublicKeyResult> {
  if (!AmberSigner) {
    throw new Error('Amber is only supported on Android');
  }
  return AmberSigner.getPublicKey();
}

export async function signEvent(
  eventJson: string,
  eventId: string,
  currentUser: string,
): Promise<SignEventResult> {
  if (!AmberSigner) {
    throw new Error('Amber is only supported on Android');
  }
  return AmberSigner.signEvent(eventJson, eventId, currentUser);
}

export async function nip04Encrypt(
  plaintext: string,
  pubkey: string,
  currentUser: string,
): Promise<{ result: string }> {
  if (!AmberSigner) {
    throw new Error('Amber is only supported on Android');
  }
  return AmberSigner.nip04Encrypt(plaintext, pubkey, currentUser);
}

export async function nip04Decrypt(
  ciphertext: string,
  pubkey: string,
  currentUser: string,
): Promise<{ result: string }> {
  if (!AmberSigner) {
    throw new Error('Amber is only supported on Android');
  }
  return AmberSigner.nip04Decrypt(ciphertext, pubkey, currentUser);
}

export async function isInstalled(): Promise<boolean> {
  if (!AmberSigner) return false;
  return AmberSigner.isInstalled();
}
