import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { MapPin, Zap, Receipt, UserRound, ImagePlus, Smile } from 'lucide-react-native';
import { colors } from '../styles/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onShareLocation: () => void;
  onSendZap?: () => void;
  onSendInvoice?: () => void;
  onShareContact?: () => void;
  onSendImage?: () => void;
  onSendGif?: () => void;
}

const AttachSheet: React.FC<Props> = ({
  visible,
  onClose,
  onShareLocation,
  onSendZap,
  onSendInvoice,
  onShareContact,
  onSendImage,
  onSendGif,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => {
    const rows =
      1 +
      (onSendZap ? 1 : 0) +
      (onSendInvoice ? 1 : 0) +
      (onShareContact ? 1 : 0) +
      (onSendImage ? 1 : 0) +
      (onSendGif ? 1 : 0);
    return [
      rows >= 6
        ? '68%'
        : rows >= 5
          ? '60%'
          : rows >= 4
            ? '52%'
            : rows >= 3
              ? '44%'
              : rows === 2
                ? '36%'
                : '28%',
    ];
  }, [onSendZap, onSendInvoice, onShareContact, onSendImage, onSendGif]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Share</Text>
        {onSendZap ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onSendZap}
            accessibilityLabel="Send a zap"
            testID="attach-send-zap"
          >
            <View style={styles.iconBadge}>
              <Zap size={22} color={colors.white} fill={colors.white} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Send zap</Text>
              <Text style={styles.rowSubtitle}>Pay sats to their lightning address.</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {onSendInvoice ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onSendInvoice}
            accessibilityLabel="Send an invoice"
            testID="attach-send-invoice"
          >
            <View style={styles.iconBadge}>
              <Receipt size={22} color={colors.white} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Send invoice</Text>
              <Text style={styles.rowSubtitle}>Create a bolt11 invoice and DM it to them.</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {onShareContact ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onShareContact}
            accessibilityLabel="Share a contact's profile"
            testID="attach-share-contact"
          >
            <View style={styles.iconBadge}>
              <UserRound size={22} color={colors.white} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Share profile</Text>
              <Text style={styles.rowSubtitle}>Send another contact's Nostr profile.</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {onSendImage ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onSendImage}
            accessibilityLabel="Send an image"
            testID="attach-send-image"
          >
            <View style={styles.iconBadge}>
              <ImagePlus size={22} color={colors.white} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Send image</Text>
              <Text style={styles.rowSubtitle}>
                Pick a photo — uploaded to your Blossom server.
              </Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {onSendGif ? (
          <TouchableOpacity
            style={styles.row}
            onPress={onSendGif}
            accessibilityLabel="Send a GIF"
            testID="attach-send-gif"
          >
            <View style={styles.iconBadge}>
              <Smile size={22} color={colors.white} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Send GIF</Text>
              <Text style={styles.rowSubtitle}>Pick a reaction GIF from GIPHY (G-rated only).</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.row}
          onPress={onShareLocation}
          accessibilityLabel="Share your current location"
          testID="attach-share-location"
        >
          <View style={styles.iconBadge}>
            <MapPin size={22} color={colors.white} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Share location</Text>
            <Text style={styles.rowSubtitle}>
              Sends your current position as an encrypted message (OpenStreetMap).
            </Text>
          </View>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textHeader,
  },
  rowSubtitle: {
    fontSize: 13,
    color: colors.textSupplementary,
    marginTop: 2,
    lineHeight: 18,
  },
});

export default AttachSheet;
