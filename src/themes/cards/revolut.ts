import { StyleSheet } from 'react-native';

// Box sized to match the wordmark's ~3.33:1 aspect so it can't overlap the balance — issue #483.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    width: 70,
    height: 21,
    right: 20,
    bottom: 10,
    opacity: 0.85,
  },
});
