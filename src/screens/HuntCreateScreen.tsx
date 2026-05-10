import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  CheckCircle2,
  ChevronLeft,
  Clipboard as ClipboardIcon,
  Globe,
  Nfc,
  PiggyBank,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import {
  LnurlWithdrawError,
  LnurlWithdrawParams,
  msatToSats,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { newPiggyId, savePiggy } from '../services/piggyStorageService';
import { writeLnurlToTag } from '../services/nfcService';

interface Props {
  navigation: ExploreNavigation;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'validated'; params: LnurlWithdrawParams }
  | { kind: 'saved'; lnurlw: string }
  | { kind: 'writing-nfc' }
  | { kind: 'wrote-nfc' };

const HuntCreateScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [lnurl, setLnurl] = useState('');
  const [memo, setMemo] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const handlePaste = useCallback(async () => {
    try {
      const v = await Clipboard.getStringAsync();
      if (v) setLnurl(v.trim());
    } catch {
      // Clipboard read can fail silently on cold start; nothing user-actionable.
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!lnurl.trim()) {
      Alert.alert('Paste an LNURL first', 'Create the link in your wallet, then paste it here.', [
        { text: 'OK' },
      ]);
      return;
    }
    setStage({ kind: 'validating' });
    try {
      const params = await resolveLnurlWithdraw(lnurl);
      setStage({ kind: 'validated', params });
    } catch (e) {
      const msg =
        e instanceof LnurlWithdrawError
          ? e.message
          : `Could not resolve LNURL: ${(e as Error).message}`;
      setStage({ kind: 'idle' });
      Alert.alert("That's not a withdraw link", msg, [{ text: 'OK' }]);
    }
  }, [lnurl]);

  const handleSave = useCallback(async () => {
    if (stage.kind !== 'validated') return;
    const piggy = {
      id: newPiggyId(),
      lnurlw: lnurl.trim(),
      memo: memo.trim(),
      createdAt: Date.now(),
      isPublic,
      maxWithdrawableMsat: stage.params.maxWithdrawable,
    };
    await savePiggy(piggy);
    setStage({ kind: 'saved', lnurlw: piggy.lnurlw });
    Toast.show({ type: 'success', text1: 'Piggy hidden 🐷' });
  }, [stage, lnurl, memo, isPublic]);

  const handleWriteNfc = useCallback(async () => {
    if (stage.kind !== 'saved' && stage.kind !== 'wrote-nfc') return;
    const value = stage.kind === 'saved' ? stage.lnurlw : lnurl;
    setStage({ kind: 'writing-nfc' });
    try {
      await writeLnurlToTag(value);
      setStage({ kind: 'wrote-nfc' });
      Toast.show({ type: 'success', text1: 'Tag written' });
    } catch (e) {
      setStage({ kind: 'saved', lnurlw: value });
      Alert.alert('Could not write tag', (e as Error).message, [{ text: 'OK' }]);
    }
  }, [stage, lnurl]);

  const handleDone = useCallback(() => navigation.goBack(), [navigation]);

  // ----- presentation helpers ------------------------------------------------

  const validatedSatsLine = (() => {
    if (stage.kind !== 'validated') return null;
    const min = msatToSats(stage.params.minWithdrawable);
    const max = msatToSats(stage.params.maxWithdrawable);
    return min === max
      ? `${max.toLocaleString()} sats per claim`
      : `${min.toLocaleString()}–${max.toLocaleString()} sats per claim`;
  })();

  return (
    <View style={styles.container} testID="hunt-create-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Hunt"
          testID="hunt-create-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hide a Piggy</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>LNURL-withdraw</Text>
        <Text style={styles.helper}>
          Create a withdraw link in your own wallet (LNbits, Alby, Mutiny, …) — set the per-claim
          amount, daily limit, and total uses there — then paste it here.
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="lnurl1… or lightning:LNURL1…"
            placeholderTextColor={colors.textSupplementary}
            value={lnurl}
            onChangeText={(s) => {
              setLnurl(s);
              if (stage.kind === 'validated') setStage({ kind: 'idle' });
            }}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            testID="hunt-piggy-lnurl-input"
          />
          <TouchableOpacity
            onPress={handlePaste}
            style={styles.pasteButton}
            accessibilityLabel="Paste from clipboard"
            testID="hunt-piggy-paste-button"
          >
            <ClipboardIcon size={18} color={colors.brandPink} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {stage.kind !== 'validated' && stage.kind !== 'saved' && stage.kind !== 'wrote-nfc' && (
          <TouchableOpacity
            style={[styles.primaryButton, !lnurl.trim() && styles.primaryButtonDisabled]}
            disabled={!lnurl.trim() || stage.kind === 'validating'}
            onPress={handleValidate}
            testID="hunt-piggy-validate-button"
          >
            {stage.kind === 'validating' ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Validate</Text>
            )}
          </TouchableOpacity>
        )}

        {stage.kind === 'validated' && (
          <View style={styles.validatedCard}>
            <CheckCircle2 size={20} color={colors.green} strokeWidth={2.5} />
            <View style={styles.validatedTextWrapper}>
              <Text style={styles.validatedTitle}>Looks good</Text>
              {validatedSatsLine && <Text style={styles.validatedMeta}>{validatedSatsLine}</Text>}
              {stage.params.defaultDescription ? (
                <Text style={styles.validatedDescription}>
                  &ldquo;{stage.params.defaultDescription}&rdquo;
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {(stage.kind === 'validated' || stage.kind === 'saved' || stage.kind === 'wrote-nfc') && (
          <>
            <Text style={[styles.sectionLabel, styles.sectionGap]}>Memo</Text>
            <TextInput
              style={styles.input}
              placeholder="Happy birthday Lily 🎂"
              placeholderTextColor={colors.textSupplementary}
              value={memo}
              onChangeText={setMemo}
              maxLength={140}
              editable={stage.kind === 'validated'}
              testID="hunt-piggy-memo-input"
            />
            <Text style={styles.helper}>Shown to the finder on the celebration screen.</Text>

            <Text style={[styles.sectionLabel, styles.sectionGap]}>Discoverability</Text>
            <TouchableOpacity
              style={styles.publicRow}
              onPress={() => stage.kind === 'validated' && setIsPublic(!isPublic)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isPublic }}
              testID="hunt-piggy-public-toggle"
              disabled={stage.kind !== 'validated'}
            >
              <Globe size={20} color={colors.brandPink} strokeWidth={2} />
              <View style={styles.publicTextWrapper}>
                <Text style={styles.publicTitle}>Make this Piggy public</Text>
                <Text style={styles.publicSub}>
                  Publishes to Nostr (kind-30408) so strangers can hunt for it. You can opt out per
                  Piggy.
                </Text>
              </View>
              <View style={[styles.toggleTrack, isPublic && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, isPublic && styles.toggleThumbOn]} />
              </View>
            </TouchableOpacity>

            <Text style={styles.warning}>
              ⚠ The URL on your Piggy is a bearer token — anyone who finds the tag (or sees the URL)
              can claim sats up to your daily limit. Set a per-find amount you&apos;re OK losing if
              it leaks.
            </Text>
          </>
        )}

        {stage.kind === 'validated' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleSave}
            testID="hunt-piggy-save-button"
          >
            <PiggyBank size={18} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.primaryButtonText}>Hide this Piggy</Text>
          </TouchableOpacity>
        )}

        {(stage.kind === 'saved' || stage.kind === 'writing-nfc' || stage.kind === 'wrote-nfc') && (
          <View style={styles.savedActions}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleWriteNfc}
              disabled={stage.kind === 'writing-nfc'}
              testID="hunt-write-nfc-button"
            >
              {stage.kind === 'writing-nfc' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Nfc size={18} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.primaryButtonText}>
                    {stage.kind === 'wrote-nfc' ? 'Write another tag' : 'Write to NFC tag'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleDone}
              testID="hunt-piggy-done-button"
            >
              <Text style={styles.secondaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: { padding: 16, gap: 10 },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    sectionGap: { marginTop: 16 },
    helper: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 17,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 6,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      fontSize: 14,
      color: colors.textBody,
      minHeight: 44,
    },
    pasteButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 100,
      marginTop: 16,
    },
    primaryButtonDisabled: {
      opacity: 0.4,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryButton: {
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    validatedCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginTop: 12,
    },
    validatedTextWrapper: { flex: 1 },
    validatedTitle: {
      color: colors.textHeader,
      fontSize: 14,
      fontWeight: '700',
    },
    validatedMeta: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    validatedDescription: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 4,
      fontStyle: 'italic',
    },
    publicRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
    },
    publicTextWrapper: { flex: 1 },
    publicTitle: {
      color: colors.textHeader,
      fontSize: 14,
      fontWeight: '700',
    },
    publicSub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    toggleTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.divider,
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    toggleTrackOn: { backgroundColor: colors.green },
    toggleThumb: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.white,
    },
    toggleThumbOn: { alignSelf: 'flex-end' },
    warning: {
      marginTop: 12,
      color: colors.textSupplementary,
      fontSize: 12,
      lineHeight: 17,
    },
    savedActions: { gap: 4 },
  });

export default HuntCreateScreen;
