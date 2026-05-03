import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { Copy, ShieldAlert } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

export interface CoinosRecoveryDetails {
  baseUrl: string;
  username: string;
  password: string;
  /** Full NIP-47 connection string. Long, but the recovery view is the
   *  one place we surface it so a power user can move the wallet to a
   *  different NWC client without re-provisioning. */
  nwc: string;
}

interface Props {
  visible: boolean;
  details: CoinosRecoveryDetails | null;
  /** Mandatory acknowledgement mode (post-create flow). When true the
   *  user can't dismiss the sheet by swipe / backdrop and the primary
   *  action reads "I've saved this somewhere". When false (re-display
   *  from Wallet Settings) the sheet is freely dismissable and the
   *  primary action reads "Done". */
  requireAcknowledge: boolean;
  onAcknowledge: () => void;
  onClose: () => void;
}

/**
 * Renders the CoinOS managed-wallet recovery info — username, password,
 * NWC connection string + a one-line restore hint.
 *
 * Funds-loss surface area: if a user wipes their device without backing
 * this up, their CoinOS balance is unrecoverable. The post-create flow
 * uses `requireAcknowledge` so the user MUST tap the primary action
 * before we let them onto Home — see `CreateLightningWalletScreen` for
 * the create-flow wiring and `WalletSettingsSheet` for the re-display
 * entry point.
 */
const CoinosRecoverySheet: React.FC<Props> = ({
  visible,
  details,
  requireAcknowledge,
  onAcknowledge,
  onClose,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ref = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['90%'], []);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    if (visible && details) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible, details]);

  const handleSheetChange = useCallback(
    (index: number) => {
      // In acknowledge-mode the sheet is `enablePanDownToClose={false}` so
      // index never reaches -1 from a swipe; this is purely the "X" /
      // backdrop fallback path used by the re-display flow.
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        // In acknowledge-mode disable backdrop-tap dismissal.
        // pressBehavior="none" matches @gorhom/bottom-sheet's intent.
        pressBehavior={requireAcknowledge ? 'none' : 'close'}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
      />
    ),
    [requireAcknowledge],
  );

  const copyToClipboard = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopyHint(label);
    setTimeout(() => setCopyHint(null), 1500);
  }, []);

  if (!details) return null;

  const host = (() => {
    try {
      return new URL(details.baseUrl).host;
    } catch {
      return details.baseUrl;
    }
  })();

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={!requireAcknowledge}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconBubble}>
          <ShieldAlert size={36} color={colors.white} strokeWidth={2.5} />
        </View>
        <Text style={styles.title} testID="coinos-recovery-title">
          Save your recovery info
        </Text>
        <Text style={styles.subtitle}>
          If you lose this device, sign in to {host} with this username and password to recover your
          funds. Lightning Piggy doesn&apos;t store these for you anywhere else.
        </Text>

        <RecoveryRow
          label="Server"
          value={details.baseUrl}
          onCopy={() => copyToClipboard('Server URL', details.baseUrl)}
          colors={colors}
          testID="coinos-recovery-server"
        />
        <RecoveryRow
          label="Username"
          value={details.username}
          onCopy={() => copyToClipboard('Username', details.username)}
          colors={colors}
          testID="coinos-recovery-username"
        />
        <RecoveryRow
          label="Password"
          value={details.password}
          onCopy={() => copyToClipboard('Password', details.password)}
          colors={colors}
          monospace
          testID="coinos-recovery-password"
        />
        <RecoveryRow
          label="NWC connection"
          value={details.nwc}
          onCopy={() => copyToClipboard('NWC connection string', details.nwc)}
          colors={colors}
          monospace
          // The NWC URL is long; the row stretches and wraps but copy
          // is still the primary affordance.
          truncate
          testID="coinos-recovery-nwc"
        />

        {copyHint && (
          <Text style={styles.copyConfirm} testID="coinos-recovery-copy-confirm">
            {copyHint} copied to clipboard.
          </Text>
        )}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={requireAcknowledge ? onAcknowledge : onClose}
          testID="coinos-recovery-acknowledge"
          accessibilityLabel={
            requireAcknowledge ? "I've saved this somewhere" : 'Close recovery info'
          }
        >
          <Text style={styles.primaryButtonText}>
            {requireAcknowledge ? "I've saved this somewhere" : 'Done'}
          </Text>
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

const RecoveryRow: React.FC<{
  label: string;
  value: string;
  onCopy: () => void;
  colors: Palette;
  monospace?: boolean;
  truncate?: boolean;
  testID?: string;
}> = ({ label, value, onCopy, colors, monospace, truncate, testID }) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        <Text
          style={[styles.rowValue, monospace ? styles.mono : null]}
          numberOfLines={truncate ? 3 : undefined}
          testID={testID}
        >
          {value}
        </Text>
        <TouchableOpacity
          onPress={onCopy}
          style={styles.copyButton}
          accessibilityLabel={`Copy ${label}`}
          testID={`${testID}-copy`}
          hitSlop={8}
        >
          <Copy size={18} color={colors.brandPink} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      padding: 24,
      paddingBottom: 40,
      gap: 14,
      alignItems: 'stretch',
    },
    iconBubble: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: 4,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 8,
    },
    row: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      gap: 6,
    },
    rowLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    rowValueWrap: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    rowValue: {
      flex: 1,
      fontSize: 14,
      color: colors.textBody,
    },
    mono: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
    },
    copyButton: {
      paddingTop: 2,
    },
    copyConfirm: {
      fontSize: 13,
      color: colors.green,
      textAlign: 'center',
      fontWeight: '600',
    },
    primaryButton: {
      marginTop: 16,
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
  });

export default CoinosRecoverySheet;
