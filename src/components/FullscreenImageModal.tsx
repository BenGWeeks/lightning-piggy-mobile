// Tap-to-dismiss full-screen image viewer for avatars / profile pictures
// (#661). Mirrors the conversation GIF-fullscreen modal: a dark backdrop,
// contain-fit image, tap anywhere to close. Rendered with `url=null` when
// hidden so the parent just toggles a single string state.

import React from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

interface Props {
  url: string | null;
  onClose: () => void;
}

const FullscreenImageModal: React.FC<Props> = ({ url, onClose }) => {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={url !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close full-screen image"
        testID="fullscreen-image-backdrop"
      >
        {url ? (
          <ExpoImage
            source={{ uri: url }}
            style={{ width, height }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityLabel="Full-screen image"
          />
        ) : null}
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FullscreenImageModal;
