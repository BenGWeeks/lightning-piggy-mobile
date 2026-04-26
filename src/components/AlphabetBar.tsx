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

    const availableSet = useMemo(() => new Set(letters), [letters]);

    const getLetterFromY = useCallback(
      (pageY: number) => {
        // The rendered bar always shows FULL_ALPHABET (27 buckets), so
        // map the touch y-position against FULL_ALPHABET.length, not the
        // (possibly smaller) `letters` subset — otherwise dragging
        // jumps because the visual letter under the finger doesn't
        // match the index the math computes. Then if the letter we
        // landed on is disabled (no contacts in that bucket), snap to
        // the nearest enabled letter so the user always sees feedback.
        const { y, height } = barLayout.current;
        if (height === 0 || letters.length === 0) return null;
        const relY = pageY - y;
        const idx = Math.max(
          0,
          Math.min(Math.floor((relY / height) * FULL_ALPHABET.length), FULL_ALPHABET.length - 1),
        );
        const target = FULL_ALPHABET[idx];
        if (availableSet.has(target)) return target;
        // Snap to the nearest enabled letter (search outward from idx).
        for (let off = 1; off < FULL_ALPHABET.length; off++) {
          const before = FULL_ALPHABET[idx - off];
          if (before && availableSet.has(before)) return before;
          const after = FULL_ALPHABET[idx + off];
          if (after && availableSet.has(after)) return after;
        }
        return null;
      },
      [letters, availableSet],
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
      // The parent (`listWithBar` in both FriendsScreen and
      // FriendPickerSheet) is `flexDirection: 'row'` so the default
      // `alignItems: 'stretch'` already gives this bar the parent's
      // full column height. We rely on that — do NOT set `flex: 1`
      // here, which would claim row WIDTH instead and visibly bloat
      // the sidebar (the per-letter `flex: 1` below uses the
      // stretched height to distribute 27 letters proportionally).
      flexDirection: 'column',
      // The visible top/bottom breathing comes from this container's
      // padding, while the per-letter `flex: 1` buckets below consume
      // the remaining height and centre each letter within its bucket.
      // `space-around` is kept defensively in case a future change
      // removes `flex: 1` from the touches; with `flex: 1` it has no
      // material effect because the buckets fill all free space.
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingTop: 8,
      paddingBottom: 8,
      width: 22,
      marginLeft: 2,
    },
    alphabetLetterTouch: {
      // `flex: 1` distributes the 27 letter buckets proportionally
      // across the bar's height, so they never overflow the container
      // (which would clip the trailing letters — V-Z were getting
      // hidden in FriendPickerSheet's bottom sheet on smaller AVDs
      // when items kept their intrinsic heights via `space-between`/
      // `space-around`). Each bucket gets ~containerHeight/27.
      flex: 1,
      paddingHorizontal: 2,
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
      // Keep the text compact so the full A-Z index is more likely to
      // remain visible in constrained layouts such as
      // FriendPickerSheet, reducing the chance that trailing letters
      // get clipped on smaller screens.
      fontSize: 9,
      lineHeight: 11,
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
