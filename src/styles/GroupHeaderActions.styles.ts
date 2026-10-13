import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createGroupHeaderActionsStyles = (_colors: Palette) =>
  StyleSheet.create({
    // Pushed to the right edge of the title row; never shrinks, so a long
    // group name truncates instead of squeezing the tag or the chat menu.
    container: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
  });
