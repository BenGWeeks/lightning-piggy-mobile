import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Copy as CopyIcon,
  Eye,
  EyeOff,
  ShieldAlert,
  QrCode as QrCodeIcon,
  Share2,
  Radio,
  KeyRound,
} from 'lucide-react-native';
import SettingsRow from './SettingsRow';
import QRCode from 'react-native-qrcode-svg';
import { Alert } from './BrandedAlert';
import type { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import type { WalletType } from '../types/wallet';
import type { CoinosRecoveryInfo } from '../services/walletStorageService';
import { hostFromBaseUrl } from '../services/coinosService';
import type { WalletSettingsSheetStyles } from '../styles/WalletSettingsSheet.styles';

interface Props {
  styles: WalletSettingsSheetStyles;
  colors: Palette;
  t: ReturnType<typeof useTranslation>;
  walletType: WalletType;
  // On-chain. `undefined` = still loading, `null` = loaded but absent, `string` = ready.
  xpubDisplay: string | null | undefined;
  onCopyXpub: () => void;
  // NWC
  relayUrl: string | null;
  nwcConnection: string | null;
  nwcRevealed: boolean;
  onToggleNwcRevealed: () => void;
  nwcQrShown: boolean;
  onToggleNwcQr: () => void;
  // CoinOS managed-wallet recovery
  coinosRecovery: CoinosRecoveryInfo | null;
  passwordRevealed: boolean;
  onTogglePasswordRevealed: () => void;
  recoveryError: string | null;
  // "Share this wallet" (NWC only, #431/#988) — opens the trust warning +
  // recipient picker in the parent sheet.
  onShare: () => void;
}

/**
 * "Connection" tab — everything about *how the wallet is reached*: the
 * relay URL, the full NWC connection string (masked, with QR + copy),
 * the CoinOS managed-wallet recovery credentials, the migrate-to-self-
 * custody affordance, and (for on-chain wallets) the extended public key.
 * Pure presentation: all secret-bearing state lives in the parent sheet.
 */
const WalletConnectionTab: React.FC<Props> = ({
  styles,
  colors,
  t,
  walletType,
  xpubDisplay,
  onCopyXpub,
  relayUrl,
  nwcConnection,
  nwcRevealed,
  onToggleNwcRevealed,
  nwcQrShown,
  onToggleNwcQr,
  coinosRecovery,
  passwordRevealed,
  onTogglePasswordRevealed,
  recoveryError,
  onShare,
}) => {
  // An NWC wallet ALWAYS has connection content — at minimum the "Share this
  // wallet" row, plus the relay / connection string once they load from
  // SecureStore. Treat the whole type as having content so the empty-state
  // ("No connection details") never flashes during that async load, and never
  // renders beside the always-present Share row.
  // For on-chain wallets, `xpubDisplay` is `undefined` while loading and
  // `null` once loaded but absent — treat loading as having content so the
  // empty state only appears after the fetch has completed (or definitively
  // found nothing).
  const xpubLoading = walletType === 'onchain' && xpubDisplay === undefined;
  const hasContent =
    (walletType === 'onchain' && (xpubLoading || !!xpubDisplay)) || walletType === 'nwc';

  return (
    <View style={styles.tabContent}>
      {/* CoinOS managed-wallet recovery callout (#287). Visually prominent
          block — pink-bordered surface with shield-alert badge — so the
          recovery credentials read as a "save this now" affordance. */}
      {coinosRecovery && (
        <View style={styles.recoveryCallout}>
          <SettingsRow
            appearance="surface"
            icon={ShieldAlert}
            title={t('walletSettingsSheet.recoveryInfoTitle')}
            testID="wallet-recovery-info-row"
            details={t('walletSettingsSheet.recoveryInfoBody', {
              host: hostFromBaseUrl(coinosRecovery.baseUrl),
            })}
          />
          <SettingsRow
            appearance="surface"
            icon={KeyRound}
            title={t('walletSettingsSheet.username')}
            testID="wallet-recovery-username-row"
          />
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={async () => {
              await Clipboard.setStringAsync(coinosRecovery.username);
              Alert.alert(
                t('walletSettingsSheet.copiedTitle'),
                t('walletSettingsSheet.coinosUsernameCopied'),
              );
            }}
            style={styles.credentialRow}
            accessibilityLabel={t('walletSettingsSheet.copyCoinosUsername')}
            testID="settings-coinos-copy-username"
          >
            <Text style={styles.credentialText} selectable>
              {coinosRecovery.username}
            </Text>
            <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
          </TouchableOpacity>

          <SettingsRow
            appearance="surface"
            icon={KeyRound}
            title={t('walletSettingsSheet.password')}
            testID="wallet-recovery-password-row"
          />
          <View style={styles.credentialRow}>
            <Text style={styles.credentialText} selectable={passwordRevealed}>
              {passwordRevealed ? coinosRecovery.password : '••••••••••••'}
            </Text>
            <TouchableOpacity
              onPress={onTogglePasswordRevealed}
              accessibilityLabel={
                passwordRevealed
                  ? t('walletSettingsSheet.hideCoinosPassword')
                  : t('walletSettingsSheet.revealCoinosPassword')
              }
              testID="settings-coinos-reveal-password"
              style={styles.credentialAction}
              hitSlop={8}
            >
              {passwordRevealed ? (
                <EyeOff size={18} color={colors.textSupplementary} strokeWidth={2} />
              ) : (
                <Eye size={18} color={colors.textSupplementary} strokeWidth={2} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                await Clipboard.setStringAsync(coinosRecovery.password);
                Alert.alert(
                  t('walletSettingsSheet.copiedTitle'),
                  t('walletSettingsSheet.coinosPasswordCopied'),
                );
              }}
              accessibilityLabel={t('walletSettingsSheet.copyCoinosPassword')}
              testID="settings-coinos-copy-password"
              style={styles.credentialAction}
              hitSlop={8}
            >
              <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* NWC connection isn't repeated inside the CoinOS callout — the
              standalone "NWC Connection" row below renders for every NWC
              wallet (#588) with the same masked + copy affordance plus a
              QR overlay, so duplicating it here would just be noise. */}

          {recoveryError && <Text style={styles.recoveryErrorText}>{recoveryError}</Text>}
        </View>
      )}

      {/* NWC wallet: relay URL (read-only) */}
      {walletType === 'nwc' && relayUrl && (
        <>
          <SettingsRow
            appearance="surface"
            icon={Radio}
            title={t('walletSettingsSheet.relay')}
            value={relayUrl}
            testID="wallet-relay-row"
          />
        </>
      )}

      {/* NWC wallet: full connection string (#588). Behind dots + eye
          toggle by default — the secret in the URL grants wallet access.
          Copy and QR are separate affordances so paste into a password
          manager / scan from another device both work without needing to
          reveal the secret first. Applies to every NWC wallet. */}
      {walletType === 'nwc' && nwcConnection && (
        <>
          <SettingsRow
            appearance="surface"
            icon={KeyRound}
            title={t('walletSettingsSheet.nwcConnection')}
            testID="wallet-nwc-connection-row"
            details={t('walletSettingsSheet.nwcConnectionHint')}
          />
          <View style={styles.nwcRow}>
            <Text
              style={styles.nwcRowText}
              selectable={nwcRevealed}
              numberOfLines={nwcRevealed ? undefined : 1}
            >
              {nwcRevealed ? nwcConnection : '••••••••••••'}
            </Text>
            <TouchableOpacity
              onPress={onToggleNwcRevealed}
              accessibilityLabel={
                nwcRevealed
                  ? t('walletSettingsSheet.hideNwcConnection')
                  : t('walletSettingsSheet.revealNwcConnection')
              }
              testID="settings-nwc-reveal"
              style={styles.credentialAction}
              hitSlop={8}
            >
              {nwcRevealed ? (
                <EyeOff size={18} color={colors.textSupplementary} strokeWidth={2} />
              ) : (
                <Eye size={18} color={colors.textSupplementary} strokeWidth={2} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onToggleNwcQr}
              accessibilityLabel={
                nwcQrShown ? t('walletSettingsSheet.hideNwcQr') : t('walletSettingsSheet.showNwcQr')
              }
              testID="settings-nwc-qr"
              style={styles.credentialAction}
              hitSlop={8}
            >
              <QrCodeIcon size={18} color={colors.textSupplementary} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                await Clipboard.setStringAsync(nwcConnection);
                Alert.alert(
                  t('walletSettingsSheet.copiedTitle'),
                  t('walletSettingsSheet.nwcConnectionCopied'),
                );
              }}
              accessibilityLabel={t('walletSettingsSheet.copyNwcConnection')}
              testID="settings-nwc-copy"
              style={styles.credentialAction}
              hitSlop={8}
            >
              <CopyIcon size={18} color={colors.brandPink} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hintText}>{t('settingsPages.connectionWarning')}</Text>
          {nwcQrShown && (
            <View style={styles.qrPanel} testID="settings-nwc-qr-panel">
              <QRCode
                value={nwcConnection}
                size={220}
                // Hard-code black-on-white so the QR stays scannable in both
                // themes — `colors.textHeader` is near-white in dark mode,
                // which against the white qrPanel background renders the QR
                // effectively invisible.
                backgroundColor="#FFFFFF"
                color="#000000"
              />
              <Text style={styles.qrHint}>{t('walletSettingsSheet.nwcQrHint')}</Text>
            </View>
          )}
        </>
      )}

      {/* NWC wallet: share the connection with a trusted contact (#431/#988).
          Grouped with the connection settings above (relay / NWC string / QR)
          because it's connection-sharing. Tapping it shows the trust warning,
          then a recipient picker; the raw connection secret is never rendered —
          it only travels inside the gift-wrapped DM. */}
      {walletType === 'nwc' && (
        <SettingsRow
          appearance="surface"
          icon={Share2}
          title={t('walletSettingsSheet.shareWallet')}
          onPress={onShare}
          testID="wallet-settings-share"
        />
      )}

      {/* On-chain wallet: show xpub (read-only).
          `undefined` = still loading (show placeholder), `null` = loaded but
          absent (render nothing), `string` = ready to display. */}
      {walletType === 'onchain' && xpubDisplay !== null && (
        <>
          <SettingsRow
            appearance="surface"
            icon={KeyRound}
            title={t('walletSettingsSheet.extendedPublicKey')}
            testID="wallet-xpub-row"
          />
          {xpubDisplay === undefined ? (
            <Text style={styles.xpubText}>{'…'}</Text>
          ) : (
            <TouchableOpacity
              onPress={onCopyXpub}
              activeOpacity={0.7}
              accessibilityLabel={t('walletSettingsSheet.copyXpub')}
              testID="settings-onchain-copy-xpub"
            >
              <Text style={styles.xpubText} numberOfLines={3}>
                {xpubDisplay}
              </Text>
              <Text style={styles.copyHint}>{t('walletSettingsSheet.tapToCopy')}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Migrate to self-custody (CoinOS managed wallets only, coming soon) */}
      {coinosRecovery && (
        <SettingsRow
          appearance="surface"
          icon={ShieldAlert}
          title={t('walletSettingsSheet.migrateSelfCustody')}
          value={t('walletSettingsSheet.comingSoon')}
          disabled
          accessibilityLabel={t('walletSettingsSheet.migrateSelfCustodyComingSoon')}
          testID="wallet-settings-migrate"
        />
      )}

      {!hasContent && (
        <Text style={styles.emptyTabText}>{t('walletSettingsSheet.noConnectionDetails')}</Text>
      )}
    </View>
  );
};

export default WalletConnectionTab;
