import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ChevronRight, KeyRound } from 'lucide-react-native';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { isKeyBackedUp } from '../services/keyBackupStatus';
import { createKeyBackupEntryStyles } from '../styles/KeyBackupEntry.styles';
import type { AccountDrawerNavigation } from '../navigation/types';

/**
 * "Back up your key" row (#1223) — self-contained (reads the active account
 * and its backup status itself) so it can move to wherever the settings
 * restructure puts account/key management. Currently in Settings → Security.
 */
const KeyBackupEntry: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createKeyBackupEntryStyles(colors), [colors]);
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
    <>
      <View style={styles.headerRow}>
        <KeyRound size={22} color={colors.white} />
        <Text style={styles.headerLabel}>{t('keyBackupScreen.entryHeader')}</Text>
      </View>
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('AccountKeyBackup', { pubkey })}
        accessibilityRole="button"
        accessibilityLabel={t('keyBackupScreen.title')}
        testID="security-key-backup"
      >
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>{t('keyBackupScreen.title')}</Text>
          <Text style={styles.rowSublabel}>{status}</Text>
        </View>
        <ChevronRight size={18} color={colors.textSupplementary} />
      </TouchableOpacity>
    </>
  );
};

export default KeyBackupEntry;
