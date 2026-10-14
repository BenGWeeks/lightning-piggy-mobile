import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { KeyRound, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createKeyBackupBannerStyles } from '../styles/KeyBackupBanner.styles';

interface Props {
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * Wallets-tab nudge to back up the active account's key (#1546) — the
 * in-app stand-in for the weekly reminder when notifications aren't allowed.
 * Presentation only; useKeyBackupReminder decides when it shows.
 */
const KeyBackupBanner: React.FC<Props> = ({ onOpen, onDismiss }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createKeyBackupBannerStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${t('keyBackupReminder.title')}: ${t('keyBackupReminder.bannerBody')}`}
      testID="key-backup-banner"
    >
      <View style={styles.iconCircle}>
        <KeyRound size={18} color={colors.white} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('keyBackupReminder.title')}</Text>
        <Text style={styles.body}>{t('keyBackupReminder.bannerBody')}</Text>
      </View>
      <TouchableOpacity
        style={styles.dismiss}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('keyBackupReminder.bannerDismiss')}
        testID="key-backup-banner-dismiss"
      >
        <X size={20} color={colors.textSupplementary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

export default React.memo(KeyBackupBanner);
