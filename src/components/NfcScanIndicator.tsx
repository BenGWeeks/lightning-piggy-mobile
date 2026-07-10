import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Nfc } from 'lucide-react-native';
import ScanRingSpinner from './ScanRingSpinner';
import { useThemeColors } from '../contexts/ThemeContext';
import { createNfcScanIndicatorStyles } from '../styles/NfcScanIndicator.styles';

interface Props {
  // Outer circle diameter; the spinning ring traces this circle and the
  // NFC glyph scales with it (64px at the default 100).
  size?: number;
  // Stop the ring when the reader isn't actually armed (NFC unsupported,
  // no wallet to receive into, etc.) so the visual never promises a scan
  // that can't happen.
  spinning?: boolean;
  testID?: string;
}

// The pink NFC-wave-in-a-circle with a rotating scan ring, shared by
// NfcReadSheet ("Try the prize") and SendSheet's NFC mode so the two
// read affordances stay visually identical.
const NfcScanIndicator: React.FC<Props> = ({ size = 100, spinning = true, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createNfcScanIndicatorStyles(colors), [colors]);
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      testID={testID}
    >
      <Nfc size={size * 0.64} color={colors.brandPink} strokeWidth={2} />
      {spinning && (
        <View style={styles.ring} pointerEvents="none">
          <ScanRingSpinner size={size} color={colors.brandPink} strokeWidth={3} />
        </View>
      )}
    </View>
  );
};

export default NfcScanIndicator;
