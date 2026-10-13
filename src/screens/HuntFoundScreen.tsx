import BrandedSpinner from '../components/BrandedSpinner';
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import Slider from '@react-native-community/slider';
import { ChevronLeft, Gift, PartyPopper, PiggyBank } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { formatFiatApprox } from '../utils/fiat';
import { useHuntFoundClaim } from '../hooks/useHuntFoundClaim';
import { useLocale } from '../contexts/LocaleContext';
import type { RouteProp } from '@react-navigation/native';
import BrandPatternBackground from '../components/BrandPatternBackground';
import { createHuntFoundScreenStyles } from '../styles/HuntFoundScreen.styles';

interface Props {
  navigation: ExploreNavigation;
  route: RouteProp<ExploreStackParamList, 'HuntFound'>;
}

/**
 * Finder celebration / claim screen for the Hunt feature (#468). Reached
 * either by deep-link (`lightning:LNURL...` URI tap → App.tsx Linking
 * listener → navigateToHuntFound) or by manual entry from elsewhere in
 * the Hunt sub-stack.
 *
 * Resolves the LUD-03 metadata, presents the issuer's memo + per-claim
 * sats, and on tap-to-claim:
 *   1. Asks the active wallet's NWC connection for a bolt11 invoice for
 *      the right amount (`makeInvoice`).
 *   2. POSTs `?k1=…&pr=<invoice>` to the issuer's callback (handled by
 *      `claimLnurlWithdraw`).
 *   3. Records the claim locally so future visits to the same Piggy can
 *      surface "you got 21 sats here 47m ago" + the soft `⚡ claimed`
 *      badge on any kind-1 reply we post (M5 step 3).
 *
 * The actual incoming-payment celebration (confetti + balance bump) fires
 * from `GlobalIncomingPaymentOverlay` when the bolt11 settles — same path
 * any other receive flow uses, no special wiring needed here.
 */
const HuntFoundScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const { t, formatLocale } = useLocale();
  const styles = useMemo(() => createHuntFoundScreenStyles(colors), [colors]);
  const { lnurl, coord } = route.params;
  const { currency } = useWallet();
  const { btcPrice } = useWalletLive();

  const { stage, amountSats, setAmountSats, handleClaim } = useHuntFoundClaim(lnurl, coord);

  // sats bounds for the 'ready' picker (LUD-03 values are millisats).
  const minSats = stage.kind === 'ready' ? Math.ceil(stage.params.minWithdrawable / 1000) : 0;
  const maxSats = stage.kind === 'ready' ? Math.floor(stage.params.maxWithdrawable / 1000) : 0;

  // Fiat label for the chosen amount in the user's currency. (Hermes Intl
  // currency formatting is patchy, so format manually with a symbol map.)
  const fiatLabel = useMemo(
    () => formatFiatApprox(amountSats, btcPrice, currency, formatLocale),
    [amountSats, btcPrice, currency, formatLocale],
  );

  // ----- render -----------------------------------------------------------

  return (
    <View style={styles.container} testID="hunt-found-screen">
      <View style={styles.header}>
        <BrandPatternBackground variant="explore-compass" />
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel={t('huntFoundScreen.close')}
          testID="hunt-found-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('huntFoundScreen.hunt')}</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <View style={styles.body}>
        {(stage.kind === 'resolving' || stage.kind === 'claiming') && (
          <>
            <View style={styles.bigPiggy}>
              <PiggyBank size={88} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.title} testID="piggy-found-celebration-screen">
              {t('huntFoundScreen.foundPiggy')}
            </Text>
            {stage.kind === 'claiming' && stage.params.defaultDescription ? (
              <Text style={styles.memo}>&ldquo;{stage.params.defaultDescription}&rdquo;</Text>
            ) : null}
            <BrandedSpinner size="large" style={{ marginTop: 8 }} />
            <Text style={styles.fineprint}>
              {stage.kind === 'resolving'
                ? t('huntFoundScreen.lookingUpPiggy')
                : t('huntFoundScreen.claimingSats')}
            </Text>
          </>
        )}

        {stage.kind === 'ready' && (
          <>
            <View style={styles.bigPiggy}>
              <PiggyBank size={88} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.title}>{t('huntFoundScreen.foundPiggy')}</Text>
            {stage.params.defaultDescription ? (
              <Text style={styles.memo}>&ldquo;{stage.params.defaultDescription}&rdquo;</Text>
            ) : null}
            <Text style={styles.amountValue} testID="hunt-found-amount-sats">
              {t('huntFoundScreen.satsAmount', { amount: amountSats.toLocaleString(formatLocale) })}
            </Text>
            {fiatLabel ? <Text style={styles.amountFiat}>{fiatLabel}</Text> : null}
            <Slider
              style={styles.slider}
              minimumValue={minSats}
              maximumValue={maxSats}
              step={1}
              value={amountSats}
              onValueChange={(v) => setAmountSats(Math.round(v))}
              minimumTrackTintColor={colors.brandPink}
              maximumTrackTintColor={colors.textSupplementary}
              thumbTintColor={colors.brandPink}
              testID="hunt-found-amount-slider"
            />
            <View style={styles.rangeRow}>
              <Text style={styles.rangeText}>{minSats.toLocaleString(formatLocale)}</Text>
              <Text style={styles.rangeText}>
                {t('huntFoundScreen.maxLabel', { amount: maxSats.toLocaleString(formatLocale) })}
              </Text>
            </View>
            <View style={styles.amountInputRow}>
              <TextInput
                style={styles.amountInput}
                keyboardType="number-pad"
                value={String(amountSats)}
                onChangeText={(t) => {
                  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                  setAmountSats(
                    Number.isFinite(n) ? Math.min(maxSats, Math.max(minSats, n)) : minSats,
                  );
                }}
                testID="hunt-found-amount-input"
                accessibilityLabel={t('huntFoundScreen.claimAmountInSats')}
              />
              <Text style={styles.amountInputUnit}>{t('huntFoundScreen.satsUnit')}</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => handleClaim(stage.params, amountSats)}
              accessibilityLabel={t('huntFoundScreen.claimSats', { amount: amountSats })}
              testID="hunt-found-claim-button"
            >
              <Gift size={20} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.primaryButtonText}>
                {t('huntFoundScreen.claimSats', {
                  amount: amountSats.toLocaleString(formatLocale),
                })}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'claimed' && (
          <>
            <View style={[styles.bigPiggy, { backgroundColor: colors.greenLight }]}>
              <PartyPopper size={88} color={colors.green} strokeWidth={2} />
            </View>
            <Text style={styles.title}>
              {t('huntFoundScreen.satsInbound', {
                amount: stage.sats.toLocaleString(formatLocale),
              })}
            </Text>
            <Text style={styles.memo}>{t('huntFoundScreen.sentToActiveWallet')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                // Bounce back to the cache detail with the composer pre-
                // opened so the finder can immediately drop a log entry
                // for future hunters. coord is required here — set by the
                // NfcReadSheet caller; the legacy deep-link entry path
                // omits it (rare) and we fall through to popToTop instead.
                if (coord) {
                  navigation.navigate('HuntPiggyDetail', { coord, openComposer: true });
                } else {
                  navigation.popToTop();
                }
              }}
              testID="hunt-found-drop-log-button"
            >
              <Gift size={20} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.primaryButtonText}>{t('huntFoundScreen.dropFindLog')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.popToTop()}
              testID="hunt-found-done-button"
            >
              <Text style={styles.secondaryButtonText}>{t('huntFoundScreen.done')}</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'sleeping' && (
          <>
            <PiggyBank size={88} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.title}>{t('huntFoundScreen.piggySleeping')}</Text>
            <Text style={styles.memo}>{stage.reason}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.goBack()}
              testID="hunt-found-back-button-2"
            >
              <Text style={styles.secondaryButtonText}>{t('huntFoundScreen.back')}</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'error' && (
          <>
            <PiggyBank size={88} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.title}>{t('huntFoundScreen.couldntClaim')}</Text>
            <Text style={styles.memo}>{stage.reason}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.goBack()}
              testID="hunt-found-back-button-3"
            >
              <Text style={styles.secondaryButtonText}>{t('huntFoundScreen.back')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

export default HuntFoundScreen;
