import { StyleSheet } from 'react-native';

// Box sized to match the lockup's ~3.8:1 aspect so it can't overlap the balance — issue #484.
export const bgStyle = StyleSheet.create({
  full: {
    position: 'absolute',
    width: 80,
    height: 21,
    right: 20,
    bottom: 10,
    opacity: 0.95,
  },
});
