// Decides what the sign-out confirmation says for one account (#1223).
//
// Signing out of a local-key ("nsec") account deletes the only copy of
// its secret key from this phone, so the prompt has to say so — and offer
// a backup — before the user taps through. Amber / NIP-46 accounts keep
// their key in the signer app, so their prompt reassures instead.
//
// Pure (no React, no storage) so every variant is unit-testable; the
// caller resolves the i18n refs with `t()` and renders the branded Alert.
import type { SignerType } from '../types/nostr';

export type SignOutPromptVariant = 'nsec-unbacked' | 'nsec-backed' | 'amber' | 'nip46';

export interface SignOutPromptInput {
  /** Signer kind of the account being signed out. `null` = unknown. */
  signerType: SignerType | null | undefined;
  /** Display name for the account (profile name, or a short npub). */
  displayName: string;
  /** Whether the user has confirmed a backup of this account's key. */
  backedUp: boolean;
  /** Other accounts on this phone that will stay signed in. */
  otherAccountCount: number;
}

export interface I18nRef {
  key: string;
  params?: Record<string, string | number>;
}

export interface SignOutPrompt {
  variant: SignOutPromptVariant;
  title: I18nRef;
  /** Message paragraphs, in display order. */
  paragraphs: I18nRef[];
  /** Offer "Back up key first" as the primary action. */
  offerBackup: boolean;
  /** Label for the destructive confirm button. */
  confirm: I18nRef;
}

export function signOutPromptVariant(
  signerType: SignerType | null | undefined,
  backedUp: boolean,
): SignOutPromptVariant {
  if (signerType === 'amber') return 'amber';
  if (signerType === 'nip46') return 'nip46';
  // 'nsec' — and unknown, which we treat as the riskiest case so we never
  // under-warn about a key that might be deleted.
  return backedUp ? 'nsec-backed' : 'nsec-unbacked';
}

export function buildSignOutPrompt(input: SignOutPromptInput): SignOutPrompt {
  const variant = signOutPromptVariant(input.signerType, input.backedUp);
  const name = { name: input.displayName };
  const paragraphs: I18nRef[] = [];

  switch (variant) {
    case 'nsec-unbacked':
      paragraphs.push({ key: 'signOutPrompt.nsecUnbacked', params: name });
      break;
    case 'nsec-backed':
      paragraphs.push({ key: 'signOutPrompt.nsecBacked', params: name });
      break;
    case 'amber':
      paragraphs.push({ key: 'signOutPrompt.amber' });
      break;
    case 'nip46':
      paragraphs.push({ key: 'signOutPrompt.nip46' });
      break;
  }

  if (input.otherAccountCount > 0) {
    paragraphs.push({
      key:
        input.otherAccountCount === 1
          ? 'signOutPrompt.otherAccountOne'
          : 'signOutPrompt.otherAccountsMany',
      params: { count: input.otherAccountCount },
    });
  }

  const offerBackup = variant === 'nsec-unbacked';
  return {
    variant,
    title: { key: 'signOutPrompt.title', params: name },
    paragraphs,
    offerBackup,
    confirm: { key: offerBackup ? 'signOutPrompt.signOutAnyway' : 'signOutPrompt.signOut' },
  };
}
