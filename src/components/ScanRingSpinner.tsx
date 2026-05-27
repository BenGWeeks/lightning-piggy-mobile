import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  // Outer diameter — set this to the circle the ring should trace.
  size: number;
  color: string;
  strokeWidth?: number;
  // Fraction of the circle that's drawn (the rest is the gap that reads as motion).
  arc?: number;
}

// A thin circular arc that rotates forever — a spinner sized to ring an icon,
// where react-native's ActivityIndicator can't control diameter or thickness.
const ScanRingSpinner: React.FC<Props> = ({ size, color, strokeWidth = 3, arc = 0.7 }) => {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference * arc} ${circumference}`}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
};

export default ScanRingSpinner;
