import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, AppState, type AppStateStatus } from 'react-native';
import NfcScanIndicator from './NfcScanIndicator';
import {
  isNfcSupported,
  scanNfcTag,
  cancelNfcOperation,
  type NfcTagContent,
} from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSendNfcPaneStyles } from '../styles/SendNfcPane.styles';

interface Props {
  // Arm the reader while true; flipping false cancels the session.
  active: boolean;
  onContent: (content: NfcTagContent) => void;
}

type PaneStatus = 'checking' | 'armed' | 'unsupported' | 'error';

// NFC mode of the Send sheet: arms Android reader-mode and hands whatever
// the tag holds (bolt11 / lightning address / LNURL / npub) back to the
// sheet's processInput pipeline. Mirrors NfcReadSheet's lessons: re-arm
// after returning from background (the OS tears the reader down on
// onPause), and never leave a dangling session on unmount.
const SendNfcPane: React.FC<Props> = ({ active, onContent }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createSendNfcPaneStyles(colors), [colors]);
  const [status, setStatus] = useState<PaneStatus>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  // Refs so the arm loop never goes stale against parent re-renders and
  // the AppState effect can re-subscribe on `active` alone.
  const activeRef = useRef(active);
  const onContentRef = useRef(onContent);
  useEffect(() => {
    activeRef.current = active;
    onContentRef.current = onContent;
  }, [active, onContent]);

  const arm = useCallback(async () => {
    setErrorMessage('');
    if (!(await isNfcSupported())) {
      setStatus('unsupported');
      return;
    }
    if (!activeRef.current) return;
    setStatus('armed');
    try {
      const content = await scanNfcTag();
      if (!activeRef.current) return;
      onContentRef.current(content);
      // If the parent didn't advance (e.g. the tag was a claim code and
      // only raised an alert), quietly re-arm for another tap.
      setTimeout(() => {
        if (activeRef.current) void arm();
      }, 600);
    } catch (err) {
      if (!activeRef.current) return;
      const raw = err instanceof Error ? err.message : 'Failed to read NFC tag';
      // Session cancelled (mode switch / sheet close) — not an error.
      if (/cancell?ed/i.test(raw)) return;
      setStatus('error');
      setErrorMessage(
        /NFC unavailable on this device/i.test(raw)
          ? 'NFC is turned off. Please enable NFC in your device settings.'
          : raw,
      );
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void arm();
    return () => cancelNfcOperation();
  }, [active, arm]);

  // Android pauses reader-mode when the app backgrounds and doesn't
  // resume it — re-arm on return (same fix as NfcReadSheet, #580).
  useEffect(() => {
    if (!active) return;
    let lastState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasBackground = lastState === 'background' || lastState === 'inactive';
      lastState = next;
      if (next === 'active' && wasBackground && activeRef.current) {
        void arm();
      }
    });
    return () => sub.remove();
  }, [active, arm]);

  return (
    <View style={styles.container} testID="send-nfc-pane">
      <NfcScanIndicator spinning={status === 'armed'} testID="send-nfc-indicator" />
      {status === 'unsupported' ? (
        <Text style={styles.description}>NFC isn't available on this device.</Text>
      ) : status === 'error' ? (
        <>
          <Text style={styles.description}>{errorMessage}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void arm()}
            accessibilityLabel="Try NFC again"
            testID="send-nfc-retry"
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.instruction}>Hold the tag to the back of your phone</Text>
          <Text style={styles.description}>
            We'll read a Lightning invoice, address or LNURL from the tag automatically.
          </Text>
        </>
      )}
    </View>
  );
};

export default SendNfcPane;
