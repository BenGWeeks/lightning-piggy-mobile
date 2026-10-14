import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { KeyRound } from 'lucide-react-native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { isKeyBackedUp } from '../services/keyBackupStatus';
import SettingsRow from './SettingsRow';
import type { AccountDrawerNavigation } from '../navigation/types';

/**
 * "Back up your key" row (#1223) — self-contained (reads the active account
 * and its backup status itself) so it can move to wherever the settings
 * restructure puts account/key management. Currently in Settings → Security.
 */
const KeyBackupEntry: React.FC = () => {
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const { pubkey, signerType, isLoggedIn } = useNostr();
  const [backedUp, setBackedUp] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      isKeyBackedUp(pubkey).then((v) => !cancelled && setBackedUp(v));
      return () => {
        cancelled = true;
      };
    }, [pubkey]),
  );

  if (!isLoggedIn || !pubkey) return null;

  const status =
    signerType === 'amber'
      ? t('keyBackupScreen.entryAmber')
      : signerType === 'nip46'
        ? t('keyBackupScreen.entrySigner')
        : backedUp
          ? t('keyBackupScreen.statusBackedUp')
          : t('keyBackupScreen.statusNotBackedUp');

  return (
    <SettingsRow
      kind="navigate"
      icon={KeyRound}
      title={t('keyBackupScreen.title')}
      subtitle={status}
      testID="security-key-backup"
      onPress={() => navigation.navigate('AccountKeyBackup', { pubkey })}
    />
  );
};

export default KeyBackupEntry;
