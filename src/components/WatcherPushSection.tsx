import BrandedSpinner from './BrandedSpinner';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { MessageCircle, Zap, AtSign, CreditCard } from 'lucide-react-native';

import Toast from './BrandedToast';
import SettingsRow from './SettingsRow';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
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

const LABEL: Record<WatcherCategory, string> = {
  dm: 'securityScreen.watcherDm',
  zap: 'securityScreen.watcherZap',
  mention: 'securityScreen.watcherMention',
  payment: 'securityScreen.watcherPayment',
};

/**
 * Settings → Notifications, below instant alerts: what Lightning Piggy's
 * notification watcher should tell this phone about. Categories default on
 * for the first account and are only switchable while push is on (it needs the device token
 * the Marmot push switch obtains). Toggles save at once; the registration
 * follows a moment later, so a burst of changes is one signer approval.
 */
const WatcherPushSection: React.FC<{ pushEnabled: boolean }> = ({ pushEnabled }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const { signerType } = useNostr();
  const push = useMemo(() => createMarmotPushSectionStyles(colors), [colors]);
  const [categories, setCategories] = useState<WatcherCategories>(NO_CATEGORIES);
  const [status, setStatus] = useState<WatcherStatus>(getWatcherStatus);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState<WatcherCategory | null>(null);
  const [retrying, setRetrying] = useState(false);
  const remoteSigner = signerType === 'amber' || signerType === 'nip46';

  const reload = useCallback(async () => {
    const stored = await getWatcherCategories().catch(() => null);
    if (stored && !savingRef.current) setCategories(stored);
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
    if (savingRef.current) return;
    savingRef.current = true;
    const previous = categories;
    setSaving(category);
    setCategories((c) => ({ ...c, [category]: on }));
    const saved = await setWatcherCategory(category, on).catch(() => null);
    if (saved) {
      setCategories(saved);
    } else {
      Toast.show({ type: 'error', text1: t('securityScreen.watcherSaveFailed') });
      setCategories(previous);
    }
    savingRef.current = false;
    setSaving(null);
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
      {WATCHER_CATEGORIES.map((category) => (
        <React.Fragment key={category}>
          <View style={push.separator} />
          <SettingsRow
            kind="toggle"
            icon={{ dm: MessageCircle, zap: Zap, mention: AtSign, payment: CreditCard }[category]}
            title={t(LABEL[category])}
            indent
            subtitle={t(
              categories[category]
                ? 'notificationSettingsScreen.on'
                : 'notificationSettingsScreen.off',
            )}
            disabled={!pushEnabled}
            disabledSubtitle={t('notificationSettingsScreen.needsInstant')}
            testID={`security-watcher-row-${category}`}
            infoTestID={category === 'dm' ? 'security-watcher-details' : undefined}
            details={
              category === 'dm'
                ? [
                    t('securityScreen.watcherPushHint'),
                    t('securityScreen.watcherPushPrivacy'),
                    t('securityScreen.watcherPaymentNote'),
                    remoteSigner && t('securityScreen.watcherSignerNote'),
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : undefined
            }
            toggle={{
              value: pushEnabled && categories[category],
              pending: saving !== null,
              pendingTestID: `security-watcher-pending-${category}`,
              disabled: !pushEnabled,
              onValueChange: (on) => void toggle(category, on),
              testID: `security-watcher-toggle-${category}`,
            }}
          />
        </React.Fragment>
      ))}
      {pushEnabled && statusText && (anyCategory(categories) || canRetry) && (
        <View style={push.statusRow} testID="security-watcher-status">
          <Text style={push.statusText}>{statusText}</Text>
          {(status.busy || retrying) && (
            <BrandedSpinner testID="security-watcher-busy" onGradient />
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
