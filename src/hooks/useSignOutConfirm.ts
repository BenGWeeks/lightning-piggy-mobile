// Shows the per-account sign-out confirmation (#1223). Shared by the
// drawer's Sign Out row and the Manage accounts sheet so both say the
// same thing. Copy + button set come from the pure `buildSignOutPrompt`.
import { useCallback } from 'react';
import { Alert, type BrandedAlertButton } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { isKeyBackedUp } from '../services/keyBackupStatus';
import { buildSignOutPrompt } from '../utils/signOutPrompt';
import type { SignerType } from '../types/nostr';

export interface SignOutConfirmRequest {
  pubkey: string;
  signerType: SignerType | null | undefined;
  displayName: string;
  otherAccountCount: number;
  onConfirm: () => void;
  /** Opens the Back up your key screen for `pubkey`. */
  onBackup: () => void;
}

export function useSignOutConfirm(): (req: SignOutConfirmRequest) => Promise<void> {
  const t = useTranslation();
  return useCallback(
    async (req: SignOutConfirmRequest) => {
      const backedUp =
        req.signerType === 'amber' || req.signerType === 'nip46'
          ? false
          : await isKeyBackedUp(req.pubkey);
      const prompt = buildSignOutPrompt({
        signerType: req.signerType,
        displayName: req.displayName,
        backedUp,
        otherAccountCount: req.otherAccountCount,
      });
      const cancel: BrandedAlertButton = {
        text: t('signOutPrompt.cancel'),
        style: 'cancel',
        testID: 'sign-out-cancel',
      };
      const confirm: BrandedAlertButton = {
        text: t(prompt.confirm.key),
        style: 'destructive',
        onPress: req.onConfirm,
        testID: 'sign-out-confirm',
      };
      // Three actions stack vertically: the safe primary action on top,
      // Cancel last. Two actions sit side by side, Cancel on the left.
      const buttons: BrandedAlertButton[] = prompt.offerBackup
        ? [
            {
              text: t('signOutPrompt.backUpFirst'),
              onPress: req.onBackup,
              testID: 'sign-out-backup-first',
            },
            confirm,
            cancel,
          ]
        : [cancel, confirm];
      Alert.alert(
        t(prompt.title.key, prompt.title.params),
        prompt.paragraphs.map((p) => t(p.key, p.params)).join('\n\n'),
        buttons,
      );
    },
    [t],
  );
}
