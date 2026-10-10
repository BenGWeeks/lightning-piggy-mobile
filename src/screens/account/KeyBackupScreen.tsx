import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nip19 from 'nostr-tools/nip19';
import { Check, Copy, Eye, EyeOff, KeyRound, TriangleAlert } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { Toast } from '../../components/BrandedToast';
import { useNostr, OWN_PROFILE_CACHE_KEY_BASE } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useKeyBackupReveal } from '../../hooks/useKeyBackupReveal';
import { isKeyBackedUp, markKeyBackedUp } from '../../services/keyBackupStatus';
import { perAccountKey } from '../../services/perAccountStorage';
import {
  SENSITIVE_CLIPBOARD_CLEAR_MS,
  canCopySensitiveText,
} from '../../services/sensitiveClipboard';
import { createKeyBackupScreenStyles } from '../../styles/KeyBackupScreen.styles';
import type { AccountDrawerParamList } from '../../navigation/types';
import type { NostrProfile } from '../../types/nostr';

const MASK = '••••••••••••••••••••••••';

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

/**
 * Back up your key (#1223). For a local-key ("nsec") account: explain what
 * the key is, gate it behind device authentication, show it masked with an
 * eye toggle, copy through the platform's secret clipboard (Copy is hidden
 * on a build without it — reveal-only), and record the user's "I've
 * saved it" per account. Amber / NIP-46 accounts get a short note instead —
 * their key never lives in this app.
 *
 * Reachable from the sign-out prompt and Settings → Security (via
 * KeyBackupEntry, so the entry point can move with a settings restructure).
 */
const KeyBackupScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createKeyBackupScreenStyles(colors), [colors]);
  const route = useRoute<RouteProp<AccountDrawerParamList, 'AccountKeyBackup'>>();
  const { pubkey: activePubkey, signerType: activeSignerType, identities, profile } = useNostr();

  const targetPubkey = route.params?.pubkey ?? activePubkey;
  const isActive = targetPubkey === activePubkey;
  const signerType = isActive
    ? activeSignerType
    : identities.find((i) => i.pubkey === targetPubkey)?.signerType;

  // NIP-46 is a live session, not an entry in the nsec/Amber registry.
  const knownAccount =
    (isActive && activeSignerType === 'nip46') || identities.some((i) => i.pubkey === targetPubkey);

  const [backedUp, setBackedUp] = useState(false);
  const [cachedName, setCachedName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const reveal = useKeyBackupReveal(
    knownAccount && signerType === 'nsec' ? (targetPubkey ?? null) : null,
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setCopied(false);
      setBackedUp(false);
      setCachedName(null);
      if (targetPubkey) {
        isKeyBackedUp(targetPubkey).then((v) => !cancelled && setBackedUp(v));
        if (!isActive) {
          AsyncStorage.getItem(perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, targetPubkey))
            .then((raw) => {
              if (cancelled || !raw) return;
              const p = JSON.parse(raw) as NostrProfile;
              setCachedName(p.displayName || p.name || null);
            })
            .catch(() => {});
        }
      }
      return () => {
        cancelled = true;
      };
    }, [targetPubkey, isActive]),
  );

  const displayName = targetPubkey
    ? (isActive ? profile?.displayName || profile?.name : cachedName) || shortNpub(targetPubkey)
    : '';

  const handleCopy = async () => {
    const ok = await reveal.copy();
    setCopied(ok);
  };

  const handleSaved = async () => {
    if (!targetPubkey || !knownAccount || !reveal.hasUnlocked) return;
    await markKeyBackedUp(targetPubkey);
    setBackedUp(true);
    Toast.show({ type: 'success', text1: t('keyBackupScreen.markedBackedUp') });
  };

  // No account, or one that has since been signed out (e.g. a stale
  // restored navigation state) — there is no key to talk about.
  if (!targetPubkey || !knownAccount) {
    return (
      <AccountScreenLayout title={t('keyBackupScreen.title')}>
        <Text style={styles.paragraph}>{t('keyBackupScreen.notSignedIn')}</Text>
      </AccountScreenLayout>
    );
  }

  if (signerType !== 'nsec') {
    const isAmber = signerType === 'amber';
    return (
      <AccountScreenLayout title={t('keyBackupScreen.title')}>
        <Text style={styles.accountName}>
          {t('keyBackupScreen.account', { name: displayName })}
        </Text>
        <View style={[shared.card, styles.signerCard]} testID="key-backup-signer-note">
          <KeyRound size={24} color={colors.white} />
          <View style={styles.signerCardText}>
            <Text style={styles.signerTitle}>
              {t(isAmber ? 'keyBackupScreen.keptInAmber' : 'keyBackupScreen.keptInSigner')}
            </Text>
            <Text style={styles.paragraph}>
              {t(isAmber ? 'keyBackupScreen.keptInAmberBody' : 'keyBackupScreen.keptInSignerBody')}
            </Text>
          </View>
        </View>
      </AccountScreenLayout>
    );
  }

  const showKey = reveal.revealed && reveal.nsec;
  const canCopy = canCopySensitiveText();
  return (
    <AccountScreenLayout title={t('keyBackupScreen.title')}>
      <Text style={styles.accountName}>{t('keyBackupScreen.account', { name: displayName })}</Text>

      <View style={shared.card}>
        <Text style={shared.sectionLabel}>{t('keyBackupScreen.whatIsIt')}</Text>
        <Text style={styles.paragraph}>
          {t('keyBackupScreen.explainControl', { name: displayName })}
        </Text>
        <Text style={styles.paragraph}>{t('keyBackupScreen.explainOnlyHere')}</Text>
        <Text style={styles.paragraph}>{t('keyBackupScreen.explainKeepSafe')}</Text>
      </View>

      <View style={styles.statusRow} testID="key-backup-status">
        {backedUp ? (
          <Check size={16} color={colors.green} strokeWidth={3} />
        ) : (
          <TriangleAlert size={16} color={colors.amber} />
        )}
        <Text style={[styles.statusText, { color: backedUp ? colors.green : colors.amber }]}>
          {t(backedUp ? 'keyBackupScreen.statusBackedUp' : 'keyBackupScreen.statusNotBackedUp')}
        </Text>
      </View>

      <View style={styles.keyBox}>
        <Text
          style={[styles.keyText, !showKey && styles.keyTextMasked]}
          testID="key-backup-key-text"
          accessibilityLabel={showKey ? undefined : t('keyBackupScreen.keyHidden')}
        >
          {showKey ? reveal.nsec : MASK}
        </Text>
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={reveal.toggleReveal}
          disabled={reveal.busy}
          accessibilityRole="button"
          accessibilityLabel={t(showKey ? 'keyBackupScreen.hideKey' : 'keyBackupScreen.showKey')}
          testID="key-backup-reveal-toggle"
        >
          {reveal.busy ? (
            <ActivityIndicator color={colors.brandPink} />
          ) : showKey ? (
            <EyeOff size={24} color={colors.brandPink} />
          ) : (
            <Eye size={24} color={colors.brandPink} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>{t('keyBackupScreen.revealHint')}</Text>
      {reveal.error && (
        <Text style={styles.errorText} testID="key-backup-error">
          {t(
            reveal.error === 'auth-failed'
              ? 'keyBackupScreen.authFailed'
              : 'keyBackupScreen.keyMissing',
          )}
        </Text>
      )}

      {canCopy && (
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleCopy}
          disabled={reveal.busy}
          accessibilityRole="button"
          accessibilityLabel={t('keyBackupScreen.copyKey')}
          testID="key-backup-copy"
        >
          <View style={styles.buttonRow}>
            <Copy size={18} color={colors.white} />
            <Text style={styles.secondaryButtonText}>{t('keyBackupScreen.copyKey')}</Text>
          </View>
        </TouchableOpacity>
      )}
      {canCopy && copied && (
        <Text style={styles.hint} testID="key-backup-copied-note">
          {t('keyBackupScreen.copiedNote', {
            seconds: Math.round(SENSITIVE_CLIPBOARD_CLEAR_MS / 1000),
          })}
        </Text>
      )}

      <TouchableOpacity
        style={[shared.saveButton, !reveal.hasUnlocked && styles.buttonDisabled]}
        onPress={handleSaved}
        disabled={!reveal.hasUnlocked}
        accessibilityRole="button"
        accessibilityState={{ disabled: !reveal.hasUnlocked }}
        accessibilityLabel={t('keyBackupScreen.savedIt')}
        testID="key-backup-confirm-saved"
      >
        <Text style={shared.saveButtonText}>{t('keyBackupScreen.savedIt')}</Text>
      </TouchableOpacity>
    </AccountScreenLayout>
  );
};

export default KeyBackupScreen;
