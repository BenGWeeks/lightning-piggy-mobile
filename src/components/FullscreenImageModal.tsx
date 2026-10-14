// Full-screen image viewer for avatars / profile pictures (#661), with
// pinch-to-zoom + pan, double-tap-to-zoom, and single-tap-to-dismiss. Pass
// `urls` (e.g. a Market listing's photos, #1531) to make it a swipeable
// gallery that opens at `url`.
//
// NB: a Modal renders in its own native window outside the app's root view, so
// the GestureHandlerRootView at App.tsx doesn't wrap it — we add a local one
// here or the gestures silently no-op (known RNGH + Modal gotcha).

import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Modal,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from '../contexts/LocaleContext';
import ZoomableImage from './ZoomableImage';
import { fullscreenImageModalStyles as styles } from '../styles/FullscreenImageModal.styles';

interface Props {
  /** The image to show; `null` hides the viewer. */
  url: string | null;
  onClose: () => void;
  /**
   * Optional set of images `url` belongs to, in display order. With two or
   * more (and `url` among them) the viewer opens at `url` and swipes between
   * them; otherwise it shows `url` alone.
   */
  urls?: readonly string[];
}

interface GalleryProps {
  urls: readonly string[];
  initialIndex: number;
  width: number;
  height: number;
  topInset: number;
  onClose: () => void;
}

const galleryKey = (url: string, index: number) => `${index}:${url}`;

/** Horizontally paged gallery of zoomable images. */
const FullscreenGallery = React.memo(
  ({ urls, initialIndex, width, height, topInset, onClose }: GalleryProps) => {
    const t = useTranslation();
    const [index, setIndex] = useState(initialIndex);
    // While an image is zoomed, drags pan it instead of paging the gallery.
    const [zoomed, setZoomed] = useState(false);
    const total = urls.length;

    const getItemLayout = useCallback(
      (_: ArrayLike<string> | null | undefined, i: number) => ({
        length: width,
        offset: width * i,
        index: i,
      }),
      [width],
    );
    // Committed once a swipe settles — never per scroll frame.
    const onMomentumScrollEnd = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const page = Math.round(e.nativeEvent.contentOffset.x / width);
        setIndex(Math.min(Math.max(page, 0), total - 1));
      },
      [width, total],
    );
    const onScrollEndDrag = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, velocity } = e.nativeEvent;
        // iOS can finish a slow drag without emitting momentum scroll end.
        if (
          velocity?.x === 0 &&
          Math.abs(contentOffset.x - Math.round(contentOffset.x / width) * width) < 0.5
        )
          onMomentumScrollEnd(e);
      },
      [width, onMomentumScrollEnd],
    );
    const renderItem = useCallback(
      ({ item, index: i }: ListRenderItemInfo<string>) => (
        <ZoomableImage
          url={item}
          width={width}
          height={height}
          accessibilityLabel={t('imageGallery.position', { current: i + 1, total })}
          onClose={onClose}
          panRequiresZoom
          onZoomChange={setZoomed}
          testID={`fullscreen-image-page-${i}`}
        />
      ),
      [width, height, t, total, onClose],
    );

    return (
      <>
        <FlatList
          testID="fullscreen-image-gallery"
          data={urls}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!zoomed}
          keyExtractor={galleryKey}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollEndDrag={onScrollEndDrag}
        />
        <View style={[styles.counter, { top: topInset + 15 }]} pointerEvents="none">
          <Text style={styles.counterText} testID="fullscreen-image-counter">
            {index + 1} / {total}
          </Text>
        </View>
      </>
    );
  },
);

FullscreenGallery.displayName = 'FullscreenGallery';

const FullscreenImageModal: React.FC<Props> = ({ url, onClose, urls }) => {
  const t = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const galleryIndex = url && urls && urls.length > 1 ? urls.indexOf(url) : -1;

  return (
    <Modal
      visible={url !== null}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.root}>
        <View
          style={styles.backdrop}
          accessibilityLabel={t('fullscreenImageModal.backdropLabel')}
          testID="fullscreen-image-backdrop"
        >
          {url && urls && galleryIndex >= 0 ? (
            // Keyed by the opened image so each opening starts at its page.
            <FullscreenGallery
              key={url}
              urls={urls}
              initialIndex={galleryIndex}
              width={width}
              height={height}
              topInset={insets.top}
              onClose={onClose}
            />
          ) : url ? (
            // Keyed so a newly opened image starts un-zoomed.
            <ZoomableImage
              key={url}
              url={url}
              width={width}
              height={height}
              accessibilityLabel={t('fullscreenImageModal.imageLabel')}
              onClose={onClose}
            />
          ) : null}
        </View>
        {/* Explicit close affordance: the backdrop dismiss is a gesture, which
            isn't exposed as an accessibility action — screen-reader users (and
            iOS, with no hardware back) need a real button (#669 review). */}
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 8 }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('fullscreenImageModal.close')}
          testID="fullscreen-image-close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={28} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
      </GestureHandlerRootView>
    </Modal>
  );
};

export default FullscreenImageModal;
