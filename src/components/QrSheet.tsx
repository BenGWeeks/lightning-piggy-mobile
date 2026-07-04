import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import QrWithIdentityToggle from './QrWithIdentityToggle';
import NfcWriteSheet from './NfcWriteSheet';
import { isNfcSupported } from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  npub: string;
  /** Optional `nostr:nprofile1…` (pubkey + relay hints) preferred over the
   * bare npub when writing to an NFC tag, so a cold-contact scanner can
   * resolve the profile on niche relays (#755). Falls back to npub. */
  nostrRef?: string;
  displayName?: string;
  lightningAddress?: string | null;
  defaultMode?: 'npub' | 'lightning';
}

const QrSheet: React.FC<Props> = ({
  visible,
  onClose,
  npub,
  nostrRef,
  displayName,
  lightningAddress,
  defaultMode = 'npub',
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['65%'], []);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcWriteVisible, setNfcWriteVisible] = useState(false);

  // Probe NFC capability on mount; same pattern as ProfileScreen.
  useEffect(() => {
    let cancelled = false;
    isNfcSupported().then((ok) => {
      if (!cancelled) setNfcSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        onDismiss={onClose}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.content}>
          <View style={styles.qrWrapper}>
            <QrWithIdentityToggle
              npub={npub}
              lightningAddress={lightningAddress}
              defaultMode={defaultMode}
              nfcSupported={nfcSupported}
              onNfcWrite={() => setNfcWriteVisible(true)}
            />
          </View>
        </BottomSheetView>
      </BottomSheetModal>

      <NfcWriteSheet
        visible={nfcWriteVisible}
        onClose={() => setNfcWriteVisible(false)}
        npub={npub}
        nostrRef={nostrRef}
        displayName={displayName ?? 'You'}
      />
    </>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      flex: 1,
      paddingTop: 24,
      paddingBottom: 40,
    },
    qrWrapper: {
      width: '100%',
    },
  });

export default QrSheet;
