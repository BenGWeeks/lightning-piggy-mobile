import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MapPin, Zap, Receipt, UserRound, ImagePlus, Camera, Smile } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  onShareLocation: () => void;
  onSendZap?: () => void;
  onSendInvoice?: () => void;
  onShareContact?: () => void;
  onSendImage?: () => void;
  onTakePhoto?: () => void;
  onSendGif?: () => void;
}

interface Tile {
  key: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
}

/**
 * WhatsApp-style inline attachment panel — a flat 4-column grid sized
 * intrinsically by its content and rendered above the composer by the
 * parent (ConversationScreen). When opened, the parent dismisses the
 * IME rather than sizing this panel to match a cached keyboard height.
 * No sheet chrome, no backdrop, no rounded top corners — the effect
 * should still feel like the keyboard *morphed* into icons.
 */
const AttachPanel: React.FC<Props> = ({
  onShareLocation,
  onSendZap,
  onSendInvoice,
  onShareContact,
  onSendImage,
  onTakePhoto,
  onSendGif,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Build the visible tile list in display order. Optional props that
  // weren't provided (e.g. zap when the contact has no lightning
  // address) are filtered out so the grid stays compact rather than
  // showing greyed-out placeholders.
  const tiles: Tile[] = (
    [
      onTakePhoto && {
        key: 'camera',
        label: 'Camera',
        icon: <Camera size={26} color={colors.white} />,
        onPress: onTakePhoto,
        testID: 'attach-take-photo',
        accessibilityLabel: 'Take a photo with the camera',
      },
      onSendImage && {
        key: 'gallery',
        label: 'Gallery',
        icon: <ImagePlus size={26} color={colors.white} />,
        onPress: onSendImage,
        testID: 'attach-send-image',
        accessibilityLabel: 'Send an image from the gallery',
      },
      onSendGif && {
        key: 'gif',
        label: 'GIF',
        icon: <Smile size={26} color={colors.white} />,
        onPress: onSendGif,
        testID: 'attach-send-gif',
        accessibilityLabel: 'Send a GIF',
      },
      {
        key: 'location',
        label: 'Location',
        icon: <MapPin size={26} color={colors.white} />,
        onPress: onShareLocation,
        testID: 'attach-share-location',
        accessibilityLabel: 'Share your current location',
      },
      onSendZap && {
        key: 'zap',
        label: 'Zap',
        icon: <Zap size={26} color={colors.white} fill={colors.white} />,
        onPress: onSendZap,
        testID: 'attach-send-zap',
        accessibilityLabel: 'Send a zap',
      },
      onSendInvoice && {
        key: 'invoice',
        label: 'Invoice',
        icon: <Receipt size={26} color={colors.white} />,
        onPress: onSendInvoice,
        testID: 'attach-send-invoice',
        accessibilityLabel: 'Send an invoice',
      },
      onShareContact && {
        key: 'contact',
        label: 'Contact',
        icon: <UserRound size={26} color={colors.white} />,
        onPress: onShareContact,
        testID: 'attach-share-contact',
        accessibilityLabel: "Share a contact's profile",
      },
    ] as (Tile | false | undefined)[]
  ).filter((t): t is Tile => Boolean(t));

  return (
    <View style={styles.panel} testID="conversation-attach-panel">
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.key}
            style={styles.tile}
            onPress={tile.onPress}
            accessibilityLabel={tile.accessibilityLabel}
            testID={tile.testID}
          >
            <View style={styles.iconCircle}>{tile.icon}</View>
            <Text style={styles.label} numberOfLines={1}>
              {tile.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    panel: {
      // Intrinsic-sized: the 4-col grid drives the panel's height, so
      // we don't have to guess a keyboard height to fit. Sits above
      // the composer inside KeyboardStickyView; opening it dismisses
      // the IME (handled in ConversationScreen) so the panel + composer
      // stack never has to also accommodate the keyboard.
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // 4 columns: each tile claims 25 % of the row width. The
      // negative gap is replaced by per-tile bottom margin so wrapping
      // doesn't leave hanging horizontal gaps.
    },
    tile: {
      width: '25%',
      alignItems: 'center',
      marginBottom: 16,
      gap: 6,
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      color: colors.textBody,
      fontSize: 12,
      fontWeight: '600',
    },
  });

export default AttachPanel;
