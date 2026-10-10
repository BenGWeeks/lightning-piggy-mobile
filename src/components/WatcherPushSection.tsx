import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native';

import Toast from './BrandedToast';
import DetailsDisclosure from './DetailsDisclosure';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import {
  getWatcherCategories,
  getWatcherStatus,
  setWatcherCategory,
  subscribeWatcherStatus,
  syncWatcherNow,
} from '../services/watcherPush';
import type { WatcherStatus } from '../services/watcherPushRegistrar';
import {
  anyCategory,
  NO_CATEGORIES,
  WATCHER_CATEGORIES,
  type WatcherCategories,
  type WatcherCategory,
} from '../services/watcherRegistration';
import { createMarmotPushSectionStyles } from '../styles/MarmotPushSection.styles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';
import { createWatcherPushSectionStyles } from '../styles/WatcherPushSection.styles';

const LABEL: Record<WatcherCategory, string> = {
  dm: 'securityScreen.watcherDm',
  zap: 'securityScreen.watcherZap',
  mention: 'securityScreen.watcherMention',
  payment: 'securityScreen.watcherPayment',
};

/**
 * Settings → Security, inside the push section: what Lightning Piggy's
 * notification watcher should tell this phone about. Every category is off
 * by default and only switchable while push is on (it needs the device token
 * the Marmot push switch obtains). Toggles save at once; the registration
 * follows a moment later, so a burst of changes is one signer approval.
 */
const WatcherPushSection: React.FC<{ pushEnabled: boolean }> = ({ pushEnabled }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { signerType } = useNostr();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const push = useMemo(() => createMarmotPushSectionStyles(colors), [colors]);
  const styles = useMemo(() => createWatcherPushSectionStyles(colors), [colors]);
  const [categories, setCategories] = useState<WatcherCategories>(NO_CATEGORIES);
  const [status, setStatus] = useState<WatcherStatus>(getWatcherStatus);
  const [retrying, setRetrying] = useState(false);
  const remoteSigner = signerType === 'amber' || signerType === 'nip46';

  const reload = useCallback(async () => {
    const stored = await getWatcherCategories().catch(() => null);
    if (stored) setCategories(stored);
  }, []);

  useEffect(() => {
    void reload();
    // Status changes also mark the account becoming known (after cold start).
    return subscribeWatcherStatus(() => {
      setStatus(getWatcherStatus());
      void reload();
    });
  }, [reload]);

  const toggle = async (category: WatcherCategory, on: boolean) => {
    setCategories((c) => ({ ...c, [category]: on }));
    const saved = await setWatcherCategory(category, on).catch(() => null);
    if (saved) {
      setCategories(saved);
    } else {
      Toast.show({ type: 'error', text1: t('securityScreen.watcherSaveFailed') });
      void reload();
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      const outcome = await syncWatcherNow();
      if (outcome === 'failed' || outcome === 'pending')
        Toast.show({ type: 'error', text1: t('securityScreen.watcherFailed') });
    } finally {
      setRetrying(false);
    }
  };

  const statusText =
    status.busy || retrying
      ? t('securityScreen.watcherRegistering')
      : status.last === 'registered' || status.last === 'unchanged'
        ? t('securityScreen.watcherRegistered')
        : status.last === 'pending'
          ? t('securityScreen.watcherPending')
          : status.last === 'failed'
            ? t('securityScreen.watcherFailed')
            : null;
  const canRetry =
    !status.busy && !retrying && (status.last === 'pending' || status.last === 'failed');

  return (
    <View testID="security-watcher-push">
      <Text style={styles.subHeader}>{t('securityScreen.watcherPush')}</Text>
      <Text style={shared.fieldHint}>{t('securityScreen.watcherPushHint')}</Text>
      <DetailsDisclosure
        label={t('securityScreen.privacyDetails')}
        testID="security-watcher-details"
        paragraphs={[
          t('securityScreen.watcherPushPrivacy'),
          t('securityScreen.watcherPaymentNote'),
          remoteSigner && t('securityScreen.watcherSignerNote'),
        ]}
      />
      {!pushEnabled && <Text style={shared.fieldHint}>{t('securityScreen.watcherNeedsPush')}</Text>}

      {WATCHER_CATEGORIES.map((category) => {
        const label = t(LABEL[category]);
        return (
          <View
            key={category}
            style={[screen.toggleRow, !pushEnabled && styles.disabled]}
            testID={`security-watcher-row-${category}`}
          >
            <Text style={[screen.optionLabel, screen.toggleLabel]}>{label}</Text>
            <Switch
              value={pushEnabled && categories[category]}
              disabled={!pushEnabled}
              onValueChange={(on) => void toggle(category, on)}
              accessibilityLabel={label}
              testID={`security-watcher-toggle-${category}`}
              trackColor={{ false: colors.divider, true: colors.brandPink }}
              thumbColor={pushEnabled && categories[category] ? colors.white : undefined}
            />
          </View>
        );
      })}

      {pushEnabled && statusText && (anyCategory(categories) || canRetry) && (
        <View style={push.statusRow} testID="security-watcher-status">
          <Text style={push.statusText}>{statusText}</Text>
          {(status.busy || retrying) && (
            <ActivityIndicator color={colors.white} testID="security-watcher-busy" />
          )}
          {canRetry && (
            <TouchableOpacity
              style={push.pillButton}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel={t('securityScreen.watcherRetry')}
              testID="security-watcher-retry"
            >
              <Text style={push.pillButtonText}>{t('securityScreen.watcherRetry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

export default WatcherPushSection;
