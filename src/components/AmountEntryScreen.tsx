import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft, Delete, ArrowUpDown } from 'lucide-react-native';
import { useWallet } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createAmountEntryStyles } from '../styles/AmountEntryScreen.styles';
import { satsToFiat, formatFiat } from '../services/fiatService';

interface Props {
  initialSats?: number;
  title?: string;
  minSats?: number;
  maxSats?: number;
  confirmLabel?: string;
  onConfirm: (sats: number) => void;
  onBack?: () => void;
}

type Unit = 'sats' | 'fiat';

const fiatToSats = (fiat: number, btcPrice: number | null): number => {
  if (!btcPrice || btcPrice <= 0) return 0;
  return Math.round((fiat / btcPrice) * 100_000_000);
};

type Key =
  | { kind: 'digit'; value: string; letters?: string }
  | { kind: 'decimal' }
  | { kind: 'backspace' }
  | { kind: 'empty' };

const AmountEntryScreen: React.FC<Props> = ({
  initialSats = 0,
  title = 'Custom amount',
  minSats,
  maxSats,
  confirmLabel = 'Confirm',
  onConfirm,
  onBack,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createAmountEntryStyles(colors), [colors]);
  const { btcPrice, currency } = useWallet();

  const [primaryUnit, setPrimaryUnit] = useState<Unit>('sats');
  const [satsText, setSatsText] = useState(initialSats > 0 ? String(initialSats) : '');
  const [fiatText, setFiatText] = useState(() => {
    if (initialSats > 0 && btcPrice) return satsToFiat(initialSats, btcPrice).toFixed(2);
    return '';
  });
  // `pristine` is true when the active primary field hasn't been typed
  // into since the last swap-into-that-unit. While pristine, the display
  // shows the formatted conversion (so a 3-sats → fiat swap shows
  // "< $0.01" instead of the misleading "0.00") and the first keypress
  // replaces rather than appends — phone-dialer feel.
  const [pristine, setPristine] = useState(false);

  // Keep the off-screen text in sync when btcPrice updates mid-entry —
  // without this, a swap after a price refresh can surface a stale
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btcPrice]);

  // Auto-revert to SATS if price feed drops out while user is in fiat mode.
  // Without this, `currentSats` silently collapses to 0 and confirm stays
  // disabled with no on-screen explanation.
  useEffect(() => {
    if (!btcPrice && primaryUnit === 'fiat') setPrimaryUnit('sats');
  }, [btcPrice, primaryUnit]);

  // `satsText` is the source of truth for the amount. `setPrimaryRaw`
  // keeps it in sync whether the user is typing in sats or in fiat
  // (fiat keystrokes fiat→sats-convert and write through to satsText).
  // Reading currentSats through the fiat text instead would re-round
  // via `.toFixed(2)` on every swap, so a sats→fiat→sats round-trip
  // drifts off by the rounding error (e.g. 5,000 → $3.90 → 5,006).
  const currentSats = useMemo(() => parseInt(satsText, 10) || 0, [satsText]);

  const setPrimaryRaw = useCallback(
    (next: string) => {
      if (primaryUnit === 'sats') {
        setSatsText(next);
        const sats = parseInt(next, 10) || 0;
        if (btcPrice) {
          setFiatText(sats > 0 ? satsToFiat(sats, btcPrice).toFixed(2) : '');
        } else {
          setFiatText('');
        }
      } else {
        setFiatText(next);
        const fiat = parseFloat(next) || 0;
        const sats = fiatToSats(fiat, btcPrice);
        setSatsText(sats > 0 ? String(sats) : '');
      }
    },
    [primaryUnit, btcPrice],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      // Any keypress exits pristine mode, and first press after a swap
      // starts from an empty field instead of appending to the derived
      // value (e.g. swap 3 sats → fiat displays "< $0.01" but fiatText is
      // "0.00" — tapping "5" should give "5", not be blocked by the
      // already-at-2-decimals guard).
      const current = pristine ? '' : primaryUnit === 'sats' ? satsText : fiatText;
      if (pristine) setPristine(false);
      if (primaryUnit === 'fiat') {
        const dotIdx = current.indexOf('.');
        if (dotIdx !== -1 && current.length - dotIdx - 1 >= 2) return;
      }
      const next = current === '0' ? digit : current + digit;
      setPrimaryRaw(next);
    },
    [primaryUnit, pristine, satsText, fiatText, setPrimaryRaw],
  );

  const pressDecimal = useCallback(() => {
    if (primaryUnit !== 'fiat') return;
    const current = pristine ? '' : fiatText;
    if (pristine) setPristine(false);
    if (current.includes('.')) return;
    setPrimaryRaw(current.length === 0 ? '0.' : current + '.');
  }, [primaryUnit, pristine, fiatText, setPrimaryRaw]);

  const pressBackspace = useCallback(() => {
    // Backspace while pristine fully clears — same rationale as
    // pressDigit above. Avoids the "backspace 4× through the
    // derived '0.00'" UX when the user just wants to re-enter.
    if (pristine) {
      setPrimaryRaw('');
      setPristine(false);
      return;
    }
    const current = primaryUnit === 'sats' ? satsText : fiatText;
    setPrimaryRaw(current.slice(0, -1));
  }, [primaryUnit, pristine, satsText, fiatText, setPrimaryRaw]);

  const swapPrimary = () => {
    // Can't enter fiat without a price feed — tap becomes a no-op instead
    // of flipping into a dead-end state.
    if (!btcPrice && primaryUnit === 'sats') return;
    const sats = currentSats;
    if (primaryUnit === 'sats') {
      setFiatText(btcPrice && sats > 0 ? satsToFiat(sats, btcPrice).toFixed(2) : '');
    } else {
      setSatsText(sats > 0 ? String(sats) : '');
    }
    setPrimaryUnit((u) => (u === 'sats' ? 'fiat' : 'sats'));
    // New primary is "pristine" — first press replaces instead of appends.
    setPristine(sats > 0);
  };

  // Display values: always show at least "0" so the card never looks empty.
  // For fiat, preserve a trailing dot ("0.") or user's decimal places; for
  // sats, format with thousands separators.
  //
  // Post-swap pristine state: show the `formatFiat()`-rendered value of
  // the canonical sats amount ("< $0.01" for sub-cent values) rather than
  // the raw `.toFixed(2)` text — which would misleadingly render "0.00"
  // when the user had e.g. 3 sats.
  const primaryDisplay = useMemo(() => {
    if (primaryUnit === 'fiat' && pristine && btcPrice && currentSats > 0) {
      return formatFiat(satsToFiat(currentSats, btcPrice), currency);
    }
    const raw = primaryUnit === 'sats' ? satsText : fiatText;
    if (!raw) return '0';
    if (primaryUnit === 'sats') {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n.toLocaleString() : '0';
    }
    const [intPart, fracPart] = raw.split('.');
    const intFormatted = (parseInt(intPart || '0', 10) || 0).toLocaleString();
    if (fracPart === undefined) {
      // No decimal point yet
      return raw.endsWith('.') ? `${intFormatted}.` : intFormatted;
    }
    return `${intFormatted}.${fracPart}`;
  }, [primaryUnit, pristine, btcPrice, currentSats, currency, satsText, fiatText]);

  const secondaryDisplay = useMemo(() => {
    if (primaryUnit === 'sats') {
      if (!btcPrice) return '—';
      return formatFiat(satsToFiat(currentSats, btcPrice), currency);
    }
    return `${currentSats.toLocaleString()} sats`;
  }, [primaryUnit, currentSats, btcPrice, currency]);

  const primaryUnitLabel = primaryUnit === 'sats' ? 'SATS' : currency.toUpperCase();
  const secondaryUnitLabel = primaryUnit === 'sats' ? currency.toUpperCase() : 'SATS';

  const belowMin = minSats !== undefined && currentSats > 0 && currentSats < minSats;
  const aboveMax = maxSats !== undefined && currentSats > 0 && currentSats > maxSats;
  const canConfirm = currentSats > 0 && !belowMin && !aboveMax;

  const rows: Key[][] = [
    [
      { kind: 'digit', value: '1' },
      { kind: 'digit', value: '2', letters: 'ABC' },
      { kind: 'digit', value: '3', letters: 'DEF' },
    ],
    [
      { kind: 'digit', value: '4', letters: 'GHI' },
      { kind: 'digit', value: '5', letters: 'JKL' },
      { kind: 'digit', value: '6', letters: 'MNO' },
    ],
    [
      { kind: 'digit', value: '7', letters: 'PQRS' },
      { kind: 'digit', value: '8', letters: 'TUV' },
      { kind: 'digit', value: '9', letters: 'WXYZ' },
    ],
    [
      primaryUnit === 'fiat' ? { kind: 'decimal' } : { kind: 'empty' },
      { kind: 'digit', value: '0' },
      { kind: 'backspace' },
    ],
  ];

  return (
    <View style={styles.container} testID="amount-entry-screen">
      <View style={styles.headerRow}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            testID="amount-entry-back"
            accessibilityLabel="Back"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ChevronLeft size={24} color={colors.textBody} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.topArea}>
        <View style={styles.card}>
          <View style={styles.primarySection}>
            <View style={styles.cardRowTop}>
              <Text style={styles.label}>Enter amount</Text>
              <View style={[styles.pill, styles.pillPrimary]}>
                <Text style={styles.pillText}>{primaryUnitLabel}</Text>
              </View>
            </View>
            <Text
              style={[styles.amountValue, styles.amountValuePrimary]}
              numberOfLines={1}
              adjustsFontSizeToFit
              testID="amount-entry-input"
              accessibilityLabel={`Amount ${primaryDisplay} ${primaryUnitLabel}`}
            >
              {primaryDisplay}
            </Text>
          </View>

          <View style={styles.secondarySection}>
            <View style={styles.cardRowTop}>
              <Text style={styles.label}>Will receive about</Text>
              <View style={[styles.pill, styles.pillSecondary]}>
                <Text style={styles.pillText}>{secondaryUnitLabel}</Text>
              </View>
            </View>
            <Text
              style={[styles.amountValue, styles.amountValueSecondary]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {secondaryDisplay}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.swapButton}
            onPress={swapPrimary}
            testID="amount-entry-swap"
            accessibilityLabel={`Switch primary to ${secondaryUnitLabel}`}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowUpDown size={22} color={colors.brandPink} />
            <Text style={styles.swapButtonLabel}>{secondaryUnitLabel}</Text>
          </TouchableOpacity>
        </View>

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
      </View>

      <TouchableOpacity
        style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
        onPress={() => canConfirm && onConfirm(currentSats)}
        disabled={!canConfirm}
        testID="amount-entry-confirm"
        accessibilityLabel={confirmLabel}
      >
        <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
      </TouchableOpacity>

      <View style={styles.keypad}>
        {rows.map((row, rIdx) => (
          <View key={`row-${rIdx}`} style={styles.keypadRow}>
            {row.map((k, cIdx) => {
              if (k.kind === 'empty') {
                return <View key={`cell-${rIdx}-${cIdx}`} style={styles.key} />;
              }
              if (k.kind === 'backspace') {
                return (
                  <TouchableOpacity
                    key={`cell-${rIdx}-${cIdx}`}
                    style={styles.key}
                    onPress={pressBackspace}
                    testID="amount-entry-key-del"
                    accessibilityLabel="Delete"
                  >
                    <Delete size={22} color={colors.textHeader} />
                  </TouchableOpacity>
                );
              }
              if (k.kind === 'decimal') {
                return (
                  <TouchableOpacity
                    key={`cell-${rIdx}-${cIdx}`}
                    style={[styles.key, styles.keyFilled]}
                    onPress={pressDecimal}
                    testID="amount-entry-key-decimal"
                    accessibilityLabel="Decimal point"
                  >
                    <Text style={styles.keyDigit}>.</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={`cell-${rIdx}-${cIdx}`}
                  style={[styles.key, styles.keyFilled]}
                  onPress={() => pressDigit(k.value)}
                  testID={`amount-entry-key-${k.value}`}
                  accessibilityLabel={k.value}
                >
                  <Text style={styles.keyDigit}>{k.value}</Text>
                  {k.letters ? <Text style={styles.keyLetters}>{k.letters}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
};

export default AmountEntryScreen;
