import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createVoiceNotePlayerStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', marginVertical: 2 },
    rowLeft: { justifyContent: 'flex-start' },
    rowRight: { justifyContent: 'flex-end' },
    // width 240 (outer) + 14px horizontal padding = exactly the invoiceCard /
    // contact-card footprint, so all three cards line up.
    bubble: {
      width: 240,
      maxWidth: '85%',
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bubbleMe: { backgroundColor: colors.brandPink, borderBottomRightRadius: 4 },
    bubbleThem: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
    senderLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      marginBottom: 4,
    },
    title: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    playBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    waveRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 30,
    },
    bar: { width: 3, borderRadius: 2, minHeight: 4 },
    duration: {
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      minWidth: 34,
      textAlign: 'right',
    },
    time: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
    timeMe: { color: 'rgba(255,255,255,0.8)' },
    timeThem: { color: colors.textSupplementary },
  });
