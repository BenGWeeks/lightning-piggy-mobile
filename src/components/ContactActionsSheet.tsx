import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Share2, Send, ExternalLink, Nfc } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  onShare: () => void;
  onOpenIn: () => void;
  onShareToFriend: () => void;
  onWriteToNfc: () => void;
  nfcSupported: boolean;
}

const ContactActionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  onShare,
  onOpenIn,
  onShareToFriend,
  onWriteToNfc,
  nfcSupported,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['40%'], []);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const handle =
    (cb: () => void): (() => void) =>
    () => {
      onClose();
      // Run the action just after dismiss so the new sheet/modal has space.
      setTimeout(cb, 50);
    };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: colors.divider }}
      backgroundStyle={{ backgroundColor: colors.surface }}
    >
      <BottomSheetView style={styles.container} testID="contact-actions-sheet">
        <Text style={styles.title}>{t('contactActionsSheet.contactActions')}</Text>

        <TouchableOpacity
          style={styles.row}
          onPress={handle(onShare)}
          testID="contact-action-share"
          accessibilityLabel={t('contactActionsSheet.share')}
        >
          <Share2 size={22} color={colors.brandPink} />
          <Text style={styles.rowText}>{t('contactActionsSheet.share')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={handle(onOpenIn)}
          testID="contact-action-open-in"
          accessibilityLabel={t('contactActionsSheet.openInExternalClient')}
        >
          <ExternalLink size={22} color={colors.brandPink} />
          <Text style={styles.rowText}>{t('contactActionsSheet.openIn')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={handle(onShareToFriend)}
          testID="contact-action-share-to-friend"
          accessibilityLabel={t('contactActionsSheet.shareToFriend')}
        >
          <Send size={22} color={colors.brandPink} />
          <Text style={styles.rowText}>{t('contactActionsSheet.shareToFriend')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, !nfcSupported && styles.rowDisabled]}
          onPress={handle(onWriteToNfc)}
          disabled={!nfcSupported}
          testID="contact-action-write-nfc"
          accessibilityLabel={
            nfcSupported
              ? t('contactActionsSheet.writeToNfcTag')
              : t('contactActionsSheet.writeToNfcTagUnsupported')
          }
          accessibilityState={{ disabled: !nfcSupported }}
        >
          <Nfc
            size={22}
            color={nfcSupported ? colors.brandPink : colors.textSupplementary}
            strokeWidth={2}
          />
          <Text style={[styles.rowText, !nfcSupported && styles.rowTextDisabled]}>
            {t('contactActionsSheet.writeToNfcTag')}
          </Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 4,
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    rowDisabled: {
      opacity: 0.5,
    },
    rowText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    rowTextDisabled: {
      color: colors.textSupplementary,
    },
  });

export default ContactActionsSheet;
