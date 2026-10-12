import React from 'react';
import { Modal, Pressable } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { fullscreenGifModalStyles as styles } from '../styles/FullscreenGifModal.styles';

/**
 * A tapped GIF, full screen; any tap closes it. Shared by the 1:1 and group
 * chats (it used to be inlined in both).
 */
const FullscreenGifModal: React.FC<{
  url: string | null;
  onClose: () => void;
  closeLabel: string;
  testID: string;
}> = ({ url, onClose, closeLabel, testID }) => (
  <Modal
    visible={url !== null}
    transparent
    statusBarTranslucent
    navigationBarTranslucent
    animationType="fade"
    onRequestClose={onClose}
  >
    <Pressable
      style={styles.backdrop}
      onPress={onClose}
      accessibilityLabel={closeLabel}
      testID={testID}
    >
      {url ? (
        <ExpoImage
          source={{ uri: url }}
          style={styles.image}
          contentFit="contain"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </Pressable>
  </Modal>
);

export default FullscreenGifModal;
