import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, GestureResponderEvent } from 'react-native';
import { colors } from '../styles/theme';

interface Props {
  letters: string[];
  currentLetter: string | null;
  onLetterPress: (letter: string) => void;
}

const AlphabetBar: React.FC<Props> = React.memo(
  ({ letters, currentLetter, onLetterPress }) => {
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
        {letters.map((letter) => {
          const isActive = tapped === letter || (tapped === null && currentLetter === letter);
          return (
            <TouchableOpacity
              key={letter}
              style={[styles.alphabetLetterTouch, isActive && styles.alphabetLetterActive]}
              activeOpacity={0.7}
              onPress={() => handlePress(letter)}
              accessibilityRole="button"
              accessibilityLabel={`Jump to ${letter}`}
              testID={`alphabet-${letter}`}
            >
              <Text style={[styles.alphabetLetter, isActive && styles.alphabetLetterTextActive]}>
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

const styles = StyleSheet.create({
  alphabetBar: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 2,
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
  alphabetLetterTextActive: {
    color: colors.white,
  },
});

export default AlphabetBar;
