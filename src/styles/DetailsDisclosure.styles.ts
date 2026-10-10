import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createDetailsDisclosureStyles = (colors: Palette) =>
  StyleSheet.create({
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginTop: 6,
      paddingVertical: 4,
    },
    toggleText: {
      flexShrink: 1,
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    body: {
      gap: 6,
      marginTop: 2,
    },
    paragraph: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 12,
      lineHeight: 17,
    },
  });

export type DetailsDisclosureStyles = ReturnType<typeof createDetailsDisclosureStyles>;
