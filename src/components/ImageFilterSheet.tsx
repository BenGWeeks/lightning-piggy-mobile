import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  BackHandler,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { ColorMatrix, type Matrix } from 'react-native-color-matrix-image-filters';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import {
  DEFAULT_FILTER_ID,
  FILTER_PRESETS,
  type FilterId,
  type FilterPreset,
} from '../utils/imageFilters';

interface Props {
  /** When non-null, the sheet is open and previews this local image URI. */
  imageUri: string | null;
  /** Closes the sheet without sending. */
  onCancel: () => void;
  /** Called with the (eventually filter-baked) URI to upload + send. */
  onSend: (uri: string, filterId: FilterId) => void;
  /**
   * True when the parent is mid-upload after a Send tap. The sheet stays
   * mounted (so the user sees a spinner over the preview) and the Send
   * button is disabled until the parent flips this back to false.
   */
  sending?: boolean;
}

/**
 * Filter-preview sheet shown after the user picks a photo (Camera or
 * Gallery) and before it's uploaded. Lets them pick from a horizontal
 * row of preset thumbnails — see `FILTER_PRESETS` in `utils/imageFilters`.
 *
 * Honest scope (#138): the live preview applies real color-matrix
 * filters via `react-native-color-matrix-image-filters`, but only
 * `Original` actually bakes into the uploaded bytes today. Other
 * presets pass the original image through to Blossom — see the docstring
 * in `utils/imageFilters.ts` and the follow-up issue tracked in the PR
 * description for the Skia/IFK bake pipeline that will close that gap.
 */
const ImageFilterSheet: React.FC<Props> = ({ imageUri, onCancel, onSend, sending = false }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // 90% gives a near-fullscreen preview area on a phone. We don't use
  // dynamic sizing here because the preview is intentionally large —
  // an intrinsic-sized sheet would hug the thumbnails row and bury the
  // image behind the keyboard mental-model of the parent screen.
  const snapPoints = useMemo(() => ['90%'], []);
  const { width: windowWidth } = useWindowDimensions();
  // Preview area is the screen width minus a small horizontal margin.
  // Using window width (not the sheet's own width) keeps the layout
  // identical across phone sizes without measuring the sheet itself.
  const previewSize = Math.min(windowWidth - 32, 480);

  const [selectedId, setSelectedId] = useState<FilterId>(DEFAULT_FILTER_ID);

  // Drive present/dismiss off `imageUri` so callers don't have to track
  // a separate `visible` flag — opening = "I have a picked image",
  // closing = "I don't anymore". Resetting the selection on each open
  // keeps the UX predictable: every new pick starts on Original.
  useEffect(() => {
    if (imageUri) {
      setSelectedId(DEFAULT_FILTER_ID);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [imageUri]);

  // Hardware back closes the sheet (Cancel semantics) — matches the
  // pattern in GifPickerSheet. Without this, Android back would close
  // the entire conversation, which would lose the picked image without
  // an obvious way to retry.
  useEffect(() => {
    if (!imageUri) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [imageUri, onCancel]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        // Tapping the backdrop is "Cancel" — surface that intent
        // explicitly via the press handler (the default backdrop press
        // dismisses but doesn't fire `onClose` from the sheet itself
        // until the dismiss animation runs).
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      // -1 = dismissed (pan-down or backdrop tap). Treat as Cancel so
      // the parent clears its `pendingImageUri` state and the picker
      // doesn't immediately re-open on a re-render.
      if (index === -1) onCancel();
    },
    [onCancel],
  );

  const handleSendPress = useCallback(() => {
    if (!imageUri || sending) return;
    onSend(imageUri, selectedId);
  }, [imageUri, sending, onSend, selectedId]);

  // Live preview — wrap the Image in the selected matrix filter (or
  // skip the wrap entirely for Original to avoid the native-component
  // round-trip when the user hasn't actually picked a filter).
  const renderPreview = (uri: string, matrix: Matrix | null) => {
    const image = (
      <Image
        source={{ uri }}
        style={[styles.previewImage, { width: previewSize, height: previewSize }]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        accessibilityLabel="Image preview"
      />
    );
    if (!matrix) return image;
    return <ColorMatrix matrix={matrix}>{image}</ColorMatrix>;
  };

  // Filter-thumbnail tile in the horizontal carousel. Each tile is a
  // small square preview of the picked image with the filter applied,
  // captioned with the filter's display name.
  const renderThumb = (preset: FilterPreset) => {
    const isSelected = preset.id === selectedId;
    return (
      <TouchableOpacity
        key={preset.id}
        onPress={() => setSelectedId(preset.id)}
        accessibilityLabel={`Apply ${preset.label} filter`}
        accessibilityState={{ selected: isSelected }}
        testID={`image-filter-${preset.id}`}
        style={styles.thumbWrap}
        activeOpacity={0.85}
      >
        <View style={[styles.thumbBorder, isSelected && { borderColor: colors.brandPink }]}>
          {imageUri ? renderThumbImage(imageUri, preset.matrix) : null}
        </View>
        <Text
          style={[styles.thumbLabel, isSelected && styles.thumbLabelSelected]}
          numberOfLines={1}
        >
          {preset.label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderThumbImage = (uri: string, matrix: Matrix | null) => {
    const img = (
      <Image
        source={{ uri }}
        style={styles.thumbImage}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
    if (!matrix) return img;
    return <ColorMatrix matrix={matrix}>{img}</ColorMatrix>;
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      // Stack on top of the parent AttachPanel rather than dismissing
      // it — same reason as GifPickerSheet/FriendPickerSheet.
      stackBehavior="push"
    >
      <BottomSheetView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Add a filter</Text>
          <Text style={styles.subtitle}>
            Pick a look, then tap Send. (Filters preview live; only{' '}
            <Text style={styles.subtitleEm}>Original</Text> changes the file today — full filters
            coming soon.)
          </Text>
        </View>

        <View style={styles.previewWrap}>
          {imageUri ? (
            renderPreview(imageUri, FILTER_PRESETS.find((p) => p.id === selectedId)?.matrix ?? null)
          ) : (
            <View style={[styles.previewImage, { width: previewSize, height: previewSize }]} />
          )}
          {sending ? (
            <View style={styles.previewSpinner}>
              <ActivityIndicator color={colors.white} size="large" />
            </View>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}
          accessibilityLabel="Filter presets"
          testID="image-filter-row"
        >
          {FILTER_PRESETS.map(renderThumb)}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={onCancel}
            disabled={sending}
            accessibilityLabel="Cancel and discard the picked image"
            testID="image-filter-cancel"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.sendButton, sending && styles.sendButtonDisabled]}
            onPress={handleSendPress}
            disabled={sending || !imageUri}
            accessibilityLabel="Send the image"
            testID="image-filter-send"
          >
            <Text style={styles.sendButtonText}>{sending ? 'Sending…' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const THUMB_SIZE = 64;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
    },
    container: {
      flex: 1,
      paddingBottom: 16,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
      gap: 4,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 16,
    },
    subtitleEm: {
      fontWeight: '700',
      color: colors.textBody,
    },
    previewWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    previewImage: {
      backgroundColor: colors.background,
      borderRadius: 12,
    },
    previewSpinner: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderRadius: 12,
    },
    thumbRow: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 12,
    },
    thumbWrap: {
      alignItems: 'center',
      gap: 6,
    },
    thumbBorder: {
      width: THUMB_SIZE + 4,
      height: THUMB_SIZE + 4,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: 8,
      backgroundColor: colors.background,
    },
    thumbLabel: {
      fontSize: 11,
      color: colors.textSupplementary,
      maxWidth: THUMB_SIZE + 8,
    },
    thumbLabelSelected: {
      color: colors.brandPink,
      fontWeight: '700',
    },
    actions: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingTop: 8,
      gap: 12,
    },
    button: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: colors.background,
    },
    cancelButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textBody,
    },
    sendButton: {
      backgroundColor: colors.brandPink,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
  });

export default ImageFilterSheet;
