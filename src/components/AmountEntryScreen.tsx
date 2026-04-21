import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { amountEntryStyles as styles } from '../styles/AmountEntryScreen.styles';
import { satsToFiat, formatFiat } from '../services/fiatService';

interface Props {
  initialSats?: number;
  title?: string;
  subtitle?: string;
  minSats?: number;
  maxSats?: number;
  confirmLabel?: string;
  backLabel?: string;
  onConfirm: (sats: number) => void;
  onBack: () => void;
  // When rendered inside @gorhom/bottom-sheet, the built-in TextInput is
  // required for keyboard-follow behaviour. Plain screens can opt out.
  useBottomSheetInput?: boolean;
}

type Unit = 'sats' | 'fiat';

const fiatToSats = (fiat: number, btcPrice: number | null): number => {
  if (!btcPrice || btcPrice <= 0) return 0;
  return Math.round((fiat / btcPrice) * 100_000_000);
};

const AmountEntryScreen: React.FC<Props> = ({
  initialSats = 0,
  title = 'Enter amount',
  subtitle,
  minSats,
  maxSats,
  confirmLabel = 'Confirm',
  backLabel = 'Back',
  onConfirm,
  onBack,
  useBottomSheetInput = false,
}) => {
  const { btcPrice, currency } = useWallet();

  const [primaryUnit, setPrimaryUnit] = useState<Unit>('sats');
  const [satsText, setSatsText] = useState(initialSats > 0 ? String(initialSats) : '');
  const [fiatText, setFiatText] = useState(() => {
    if (initialSats > 0 && btcPrice) return satsToFiat(initialSats, btcPrice).toFixed(2);
    return '';
  });

  // Keep the off-screen text in sync when btcPrice updates mid-entry.
  // Without this, swapping after a price refresh can surface a stale
  // converted number and round-trip back to a different sats value than
  // the user originally typed.
  useEffect(() => {
    if (!btcPrice) return;
    if (primaryUnit === 'sats') {
      const sats = parseInt(satsText, 10) || 0;
      setFiatText(sats > 0 ? satsToFiat(sats, btcPrice).toFixed(2) : '');
    } else {
      const fiat = parseFloat(fiatText) || 0;
      const sats = fiatToSats(fiat, btcPrice);
      setSatsText(sats > 0 ? String(sats) : '');
    }
    // Deliberately depend only on btcPrice — we don't want this to fire
    // on every keystroke (the onChange handler already keeps the off-side
    // in sync at typing time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btcPrice]);

  const currentSats = useMemo(() => {
    if (primaryUnit === 'sats') return parseInt(satsText, 10) || 0;
    const fiat = parseFloat(fiatText) || 0;
    return fiatToSats(fiat, btcPrice);
  }, [primaryUnit, satsText, fiatText, btcPrice]);

  const handlePrimaryChange = (text: string) => {
    if (primaryUnit === 'sats') {
      // Keep only digits for sats.
      const cleaned = text.replace(/[^\d]/g, '');
      setSatsText(cleaned);
      const sats = parseInt(cleaned, 10) || 0;
      if (btcPrice) {
        setFiatText(sats > 0 ? satsToFiat(sats, btcPrice).toFixed(2) : '');
      } else {
        setFiatText('');
      }
    } else {
      // Keep digits + single decimal point for fiat.
      const normalised = text.replace(',', '.');
      const match = normalised.match(/^\d*(?:\.\d{0,2})?/);
      const cleaned = match ? match[0] : '';
      setFiatText(cleaned);
      const fiat = parseFloat(cleaned) || 0;
      const sats = fiatToSats(fiat, btcPrice);
      setSatsText(sats > 0 ? String(sats) : '');
    }
  };

  const swapPrimary = () => {
    // Re-derive the target unit's text from the canonical sats value
    // before flipping, otherwise a stale `fiatText` (or vice versa) can
    // become the new primary and the confirmed sats will diverge from
    // what the user originally typed.
    const sats = currentSats;
    if (primaryUnit === 'sats') {
      setFiatText(btcPrice && sats > 0 ? satsToFiat(sats, btcPrice).toFixed(2) : '');
    } else {
      setSatsText(sats > 0 ? String(sats) : '');
    }
    setPrimaryUnit((u) => (u === 'sats' ? 'fiat' : 'sats'));
  };

  const primaryValue = primaryUnit === 'sats' ? satsText : fiatText;
  const primaryUnitLabel = primaryUnit === 'sats' ? 'sats' : currency;
  const primaryPlaceholder = primaryUnit === 'sats' ? '0' : '0.00';
  const primaryKeyboardType = primaryUnit === 'sats' ? 'numeric' : 'decimal-pad';

  const secondaryText =
    primaryUnit === 'sats'
      ? btcPrice
        ? formatFiat(satsToFiat(currentSats, btcPrice), currency)
        : '—'
      : `${currentSats.toLocaleString()} sats`;
  const secondarySwapLabel = primaryUnit === 'sats' ? currency : 'sats';

  const belowMin = minSats !== undefined && currentSats > 0 && currentSats < minSats;
  const aboveMax = maxSats !== undefined && currentSats > 0 && currentSats > maxSats;
  const canConfirm = currentSats > 0 && !belowMin && !aboveMax;

  const PrimaryInput = useBottomSheetInput ? BottomSheetTextInput : TextInput;

  return (
    <View style={styles.container} testID="amount-entry-screen">
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={styles.primaryRow}>
        <PrimaryInput
          style={styles.primaryInput}
          value={primaryValue}
          onChangeText={handlePrimaryChange}
          keyboardType={primaryKeyboardType}
          placeholder={primaryPlaceholder}
          placeholderTextColor={colors.textSupplementary}
          autoFocus
          testID="amount-entry-input"
          accessibilityLabel={`Amount in ${primaryUnitLabel}`}
        />
        <Text style={styles.primaryUnit}>{primaryUnitLabel}</Text>
      </View>

      <TouchableOpacity
        onPress={swapPrimary}
        style={styles.secondaryRow}
        testID="amount-entry-swap"
        accessibilityLabel={`Switch to ${secondarySwapLabel}`}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>{secondaryText}</Text>
        <Text style={styles.swapIcon}>⇄</Text>
        <Text style={styles.secondaryUnit}>{secondarySwapLabel}</Text>
      </TouchableOpacity>

      {minSats !== undefined && maxSats !== undefined ? (
        <Text style={styles.rangeText}>
          {minSats.toLocaleString()} – {maxSats.toLocaleString()} sats
        </Text>
      ) : null}

      {belowMin ? (
        <Text style={styles.warningText}>Minimum is {minSats?.toLocaleString()} sats.</Text>
      ) : null}
      {aboveMax ? (
        <Text style={styles.warningText}>Maximum is {maxSats?.toLocaleString()} sats.</Text>
      ) : null}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          testID="amount-entry-back"
          accessibilityLabel={backLabel}
        >
          <Text style={styles.backButtonText}>{backLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
          onPress={() => canConfirm && onConfirm(currentSats)}
          disabled={!canConfirm}
          testID="amount-entry-confirm"
          accessibilityLabel={confirmLabel}
        >
          <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default AmountEntryScreen;
