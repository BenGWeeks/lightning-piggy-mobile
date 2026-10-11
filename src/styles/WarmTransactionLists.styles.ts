import { StyleSheet } from 'react-native';

export const createWarmTransactionListsStyles = () =>
  StyleSheet.create({
    // The visible list fills Home's transactions panel.
    shown: {
      flex: 1,
    },
    // Warm-but-hidden lists stay mounted (rows already rendered) but take no
    // layout space and draw nothing, so revealing one is just a layout pass.
    hidden: {
      display: 'none',
    },
  });

export const warmTransactionListsStyles = createWarmTransactionListsStyles();
