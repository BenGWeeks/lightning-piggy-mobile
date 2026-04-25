import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, GestureResponderEvent } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  // Letters that have content (friends/contacts) — tappable. Letters NOT
  // in this list still render in the bar but are greyed out and
  // non-interactive (so the user sees the full A-Z index instead of a
  // truncated subset).
  letters: string[];
  currentLetter: string | null;
  onLetterPress: (letter: string) => void;
}

// `#` covers names that don't start with a Latin A-Z letter (digits,
// emoji, non-Latin scripts — see firstAlpha() in FriendPickerSheet /
// FriendsScreen).
const FULL_ALPHABET = [
  '#',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
];

const AlphabetBar: React.FC<Props> = React.memo(
  ({ letters, currentLetter, onLetterPress }) => {
    const colors = useThemeColors();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [tapped, setTapped] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onPressRef = useRef(onLetterPress);
    onPressRef.current = onLetterPress;

    const barRef = useRef<View>(null);
    const barLayout = useRef({ y: 0, height: 0 });
    const lastDragLetter = useRef<string | null>(null);

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    const handlePress = useCallback((letter: string) => {
      setTapped(letter);
      onPressRef.current(letter);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setTapped(null);
      }, 1500);
    }, []);

    const getLetterFromY = useCallback(
      (pageY: number) => {
        const { y, height } = barLayout.current;
        if (height === 0 || letters.length === 0) return null;
        const relY = pageY - y;
        const idx = Math.max(
          0,
          Math.min(Math.floor((relY / height) * letters.length), letters.length - 1),
        );
        return letters[idx];
      },
      [letters],
    );

    const handleTouchStart = useCallback((e: GestureResponderEvent) => {
      const { locationY, pageY } = e.nativeEvent;
      barLayout.current.y = pageY - locationY;
      lastDragLetter.current = null;
    }, []);

    const handleTouchMove = useCallback(
      (e: GestureResponderEvent) => {
        const pageY = e.nativeEvent.pageY;
        const letter = getLetterFromY(pageY);
        if (letter && letter !== lastDragLetter.current) {
          lastDragLetter.current = letter;
          setTapped(letter);
          onPressRef.current(letter);
          if (timerRef.current) clearTimeout(timerRef.current);
        }
      },
      [getLetterFromY],
    );

    const handleTouchEnd = useCallback(() => {
      lastDragLetter.current = null;
      timerRef.current = setTimeout(() => setTapped(null), 1500);
    }, []);

    const availableSet = useMemo(() => new Set(letters), [letters]);

    return (
      <View
        ref={barRef}
        style={styles.alphabetBar}
        accessibilityRole="list"
        accessibilityLabel="Alphabet index"
        onLayout={(e) => {
          barLayout.current.height = e.nativeEvent.layout.height;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {FULL_ALPHABET.map((letter) => {
          const enabled = availableSet.has(letter);
          const isActive =
            enabled && (tapped === letter || (tapped === null && currentLetter === letter));
          return (
            <TouchableOpacity
              key={letter}
              style={[styles.alphabetLetterTouch, isActive && styles.alphabetLetterActive]}
              activeOpacity={enabled ? 0.7 : 1}
              onPress={() => enabled && handlePress(letter)}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={enabled ? `Jump to ${letter}` : `${letter} (no contacts)`}
              accessibilityState={{ disabled: !enabled }}
              testID={`alphabet-${letter}`}
            >
              <Text
                style={[
                  styles.alphabetLetter,
                  !enabled && styles.alphabetLetterDisabled,
                  isActive && styles.alphabetLetterTextActive,
                ]}
              >
                {letter}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  },
  (prev, next) => {
    if (prev.currentLetter !== next.currentLetter) return false;
    if (prev.letters.length !== next.letters.length) return false;
    return prev.letters === next.letters || prev.letters.every((l, i) => l === next.letters[i]);
  },
);
AlphabetBar.displayName = 'AlphabetBar';

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    alphabetBar: {
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 12,
      paddingBottom: 16,
      width: 22,
      marginLeft: 2,
    },
    alphabetLetterTouch: {
      paddingHorizontal: 2,
      paddingVertical: 1,
      borderRadius: 8,
      width: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    alphabetLetterActive: {
      backgroundColor: colors.brandPink,
      borderRadius: 8,
    },
    alphabetLetter: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    alphabetLetterDisabled: {
      // Greyed-out letter for buckets with no contacts. Faded enough to
      // read as inactive but still legible so the user can verify the
      // index spans the whole alphabet.
      opacity: 0.3,
    },
    alphabetLetterTextActive: {
      color: colors.white,
    },
  });

export default AlphabetBar;
