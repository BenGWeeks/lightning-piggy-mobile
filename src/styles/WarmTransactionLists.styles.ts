import { StyleSheet } from 'react-native';

export const createWarmTransactionListsStyles = () =>
  StyleSheet.create({
    // The visible list fills Home's transactions panel.
    shown: {
      flex: 1,
    },
    // Warm-but-hidden lists stay mounted AND laid out at the panel's size
    // (rows rendered and measured), parked just past the panel's right edge,
    // which clips them. `display: 'none'` would drop their viewport, leaving
    // layout + list expansion on the reveal path; `opacity: 0` in place would
    // leave invisible rows on screen for UiAutomator / Maestro selectors.
    hidden: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '100%',
      width: '100%',
    },
  });

export const warmTransactionListsStyles = createWarmTransactionListsStyles();
