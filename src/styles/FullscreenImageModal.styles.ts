import { StyleSheet } from 'react-native';

// Theme-independent: the viewer is always a dark backdrop in both themes.
export const fullscreenImageModalStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // "2 / 5" pill, centred along the top edge on a gallery.
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  counterText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
