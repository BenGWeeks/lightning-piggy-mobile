import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createReceiveSheetStyles } from '../styles/ReceiveSheet.styles';
import { decodeLnurlWithdraw } from '../services/lnurlWithdrawService';
import SendScanPane from './SendScanPane';
import { openLnurlWithdrawSheet } from './LnurlWithdrawSheet';
import Toast from './BrandedToast';

interface Props {
  enabled: boolean;
  walletId: string | null;
  onClaimOpen: () => void;
  children: React.ReactNode;
}

// Camera intake is separate from invoice generation: only the claim host may
// resolve the voucher and mint an invoice after the user presses Redeem.
export default function ReceiveClaimScanner({ enabled, walletId, onClaimOpen, children }: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createReceiveSheetStyles(colors), [colors]);
  const [scanOpen, setScanOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const activeRef = useRef(false);
  const lastScanRef = useRef<string | null>(null);
  useLayoutEffect(
    () => () => {
      activeRef.current = false;
    },
    [],
  );

  const scan = ({ data }: { data: string }) => {
    if (!enabled || !activeRef.current || lastScanRef.current === data) return;
    lastScanRef.current = data;
    try {
      decodeLnurlWithdraw(data);
    } catch {
      Toast.show({ type: 'error', text1: t('receiveSheet.invalidClaimCode'), position: 'top' });
      return;
    }
    if (!openLnurlWithdrawSheet(data, walletId ?? undefined, true)) {
      Toast.show({ type: 'error', text1: t('receiveSheet.claimUnavailable'), position: 'top' });
      lastScanRef.current = null;
      return;
    }
    activeRef.current = false;
    setScanOpen(false);
    onClaimOpen();
  };

  return (
    <>
      {enabled && (
        <TouchableOpacity
          style={styles.secondaryActionButton}
          testID="receive-scan-to-claim"
          accessibilityLabel={t(scanOpen ? 'receiveSheet.cancelScan' : 'receiveSheet.scanToClaim')}
          onPress={() => {
            lastScanRef.current = null;
            activeRef.current = !scanOpen;
            setScanOpen(!scanOpen);
          }}
        >
          <Text style={styles.secondaryActionText}>
            {t(scanOpen ? 'receiveSheet.cancelScan' : 'receiveSheet.scanToClaim')}
          </Text>
        </TouchableOpacity>
      )}
      {enabled && scanOpen ? (
        <View style={styles.innerContent}>
          <SendScanPane
            permissionGranted={permission?.granted ?? false}
            onRequestPermission={requestPermission}
            onBarcodeScanned={scan}
          />
        </View>
      ) : (
        children
      )}
    </>
  );
}
