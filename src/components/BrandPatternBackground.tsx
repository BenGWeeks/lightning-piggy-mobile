import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Rect, G, Path, Circle, Polygon } from 'react-native-svg';
import { useThemeColors } from '../contexts/ThemeContext';

// Tone-on-tone monogram background for the Messages / Friends tabs. The mark
// is drawn INTO a solid brand ground, then the pink->purple fade washes over
// it at ~82% so it reads as Louis-Vuitton-style canvas texture rather than
// icons printed on top ("under the fade"). Pure vector via react-native-svg,
// so it avoids the 754 KB bitmap decode implicated in the cold-tab GPU stall
// (issue #245) and stays crisp at every density.

export type PatternVariant =
  | 'messages-grid'
  | 'messages-weave'
  | 'messages-marquee'
  | 'friends-grid'
  | 'friends-rotated'
  | 'friends-scatter'
  | 'explore-compass';

// Dev-only: set to a variant id to force it on both tabs while capturing
// option screenshots, then set back to null. Only honoured under __DEV__, so a
// stray value can't leak a forced variant into a production build.
const CAPTURE_VARIANT: PatternVariant | null = null;

// How much of the gradient sits over the monogram. Lower = pattern reads
// stronger. Tuned on-device.
const FADE_OPACITY = 0.82;

type MotifName =
  | 'messageCircle'
  | 'messageSquare'
  | 'zap'
  | 'users'
  | 'heart'
  | 'userRound'
  | 'compass'
  | 'map';

interface MotifInstance {
  name: MotifName;
  x: number;
  y: number;
  size: number;
  strokePx?: number;
  filledDotAt?: [number, number];
}

interface VariantConfig {
  tileW: number;
  tileH: number;
  transform?: string;
  opacity: number;
  motifs: MotifInstance[];
}

// Lucide 24x24 icon geometry, rendered as hairline strokes.
const MOTIF_PATHS: Record<
  MotifName,
  { paths?: string[]; circles?: [number, number, number][]; polygon?: string }
> = {
  messageCircle: { paths: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'] },
  messageSquare: { paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  zap: { polygon: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' },
  heart: {
    paths: [
      'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    ],
  },
  userRound: { paths: ['M20 21a8 8 0 0 0-16 0'], circles: [[12, 8, 5]] },
  users: {
    paths: [
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M22 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ],
    circles: [[9, 7, 4]],
  },
  // Lucide "compass" — outer ring + the two-tone needle as a hairline diamond.
  compass: {
    circles: [[12, 12, 10]],
    polygon: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76',
  },
  // Lucide "map" — folded map outline with the two crease lines as paths.
  map: {
    polygon: '1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6',
    paths: ['M8 2v16', 'M16 6v16'],
  },
};

const VARIANTS: Record<PatternVariant, VariantConfig> = {
  // Messages — orderly upright grid of speech bubbles.
  'messages-grid': {
    tileW: 52,
    tileH: 52,
    opacity: 0.7,
    motifs: [{ name: 'messageCircle', x: 13, y: 13, size: 26 }],
  },
  // Messages — square bubbles + sat-dot on a diagonal.
  'messages-weave': {
    tileW: 54,
    tileH: 54,
    transform: 'rotate(18)',
    opacity: 0.66,
    motifs: [{ name: 'messageSquare', x: 5, y: 5, size: 26, filledDotAt: [42, 39] }],
  },
  // Messages — bubble + lightning bolt, skewed italic.
  'messages-marquee': {
    tileW: 56,
    tileH: 76,
    transform: 'skewX(-14)',
    opacity: 0.7,
    motifs: [
      { name: 'messageCircle', x: 6, y: 6, size: 30 },
      { name: 'zap', x: 34, y: 42, size: 18 },
    ],
  },
  // Friends — orderly upright grid of people marks.
  'friends-grid': {
    tileW: 56,
    tileH: 56,
    opacity: 0.7,
    motifs: [{ name: 'users', x: 13, y: 16, size: 30 }],
  },
  // Friends — figure + heart alternating on a gentle rotation.
  'friends-rotated': {
    tileW: 58,
    tileH: 58,
    transform: 'rotate(14)',
    opacity: 0.68,
    motifs: [
      { name: 'userRound', x: 5, y: 5, size: 22 },
      { name: 'heart', x: 34, y: 34, size: 17 },
    ],
  },
  // Friends — two sizes of people mark, wide airy tile, counter-rotated.
  'friends-scatter': {
    tileW: 96,
    tileH: 58,
    transform: 'rotate(-8)',
    opacity: 0.68,
    motifs: [
      { name: 'users', x: 6, y: 8, size: 34 },
      { name: 'users', x: 62, y: 30, size: 22 },
    ],
  },
  // Explore — compass + folded map alternating on a gentle counter-rotation,
  // same two-motif rhythm as friends-rotated so the tabs read as one house.
  'explore-compass': {
    tileW: 58,
    tileH: 58,
    transform: 'rotate(-12)',
    opacity: 0.68,
    motifs: [
      { name: 'compass', x: 5, y: 5, size: 22 },
      { name: 'map', x: 33, y: 33, size: 18 },
    ],
  },
};

const STROKE = '#ffffff';

function renderMotif(m: MotifInstance, key: string) {
  const geo = MOTIF_PATHS[m.name];
  const scale = m.size / 24;
  // Keep the stroke a constant on-screen width regardless of the icon scale.
  const strokeWidth = (m.strokePx ?? 1.3) / scale;
  const elems: React.ReactNode[] = [];
  geo.paths?.forEach((d, i) => {
    elems.push(
      <Path
        key={`p${i}`}
        d={d}
        fill="none"
        stroke={STROKE}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
    );
  });
  geo.circles?.forEach((c, i) => {
    elems.push(
      <Circle
        key={`c${i}`}
        cx={c[0]}
        cy={c[1]}
        r={c[2]}
        fill="none"
        stroke={STROKE}
        strokeWidth={strokeWidth}
      />,
    );
  });
  if (geo.polygon) {
    elems.push(
      <Polygon
        key="poly"
        points={geo.polygon}
        fill="none"
        stroke={STROKE}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />,
    );
  }
  return (
    <G key={key} transform={`translate(${m.x}, ${m.y}) scale(${scale})`}>
      {elems}
    </G>
  );
}

interface Props {
  variant: PatternVariant;
  style?: StyleProp<ViewStyle>;
}

const BrandPatternBackground: React.FC<Props> = ({ variant, style }) => {
  const colors = useThemeColors();
  // CAPTURE_VARIANT only overrides in dev builds — a stray value can never
  // ship a forced variant to production.
  const active = (__DEV__ && CAPTURE_VARIANT) || variant;
  const cfg = VARIANTS[active];
  const patternId = `bp-${active}`;

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.brandPink }, style]}
      pointerEvents="none"
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={cfg.tileW}
            height={cfg.tileH}
            patternTransform={cfg.transform}
          >
            <G opacity={cfg.opacity}>
              {cfg.motifs.map((m, i) => renderMotif(m, `m${i}`))}
              {cfg.motifs
                .filter((m) => m.filledDotAt)
                .map((m, i) => (
                  <Circle
                    key={`dot${i}`}
                    cx={m.filledDotAt![0]}
                    cy={m.filledDotAt![1]}
                    r={1.6}
                    fill={STROKE}
                  />
                ))}
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>
      <LinearGradient
        colors={[colors.brandPink, colors.brandGradientMid, colors.brandPurple]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { opacity: FADE_OPACITY }]}
      />
    </View>
  );
};

export default BrandPatternBackground;
