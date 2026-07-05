import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Rect, G, Path, Circle, Polygon } from 'react-native-svg';
import { useThemeColors } from '../contexts/ThemeContext';

// Tone-on-tone monogram background for the content tabs — Messages and
// Friends, plus the Explore hub and its sub-sections (via the
// `explore-compass` variant). The mark is drawn INTO an OPAQUE pink→purple
// base gradient (the header ground), then a DIRECTIONAL alpha-ramped veil of
// the same pink→purple is laid OVER it — heavy on the LEFT (monogram nearly
// hidden, the soft "faded-left" look) easing to light on the RIGHT (monogram
// clearly visible). So the mark fades in horizontally rather than sitting at a
// single flat opacity, giving a Louis-Vuitton-style canvas texture "under the
// fade" rather than icons printed on top. Pure vector via react-native-svg, so
// it avoids the 754 KB bitmap decode implicated in the cold-tab GPU stall
// (issue #245) and stays crisp at every density.

export type PatternVariant = 'messages-weave' | 'friends-rotated' | 'explore-compass';

// Directional fade veil over the monogram (#995). The pink→purple wash sits
// OVER the monogram with a horizontal ALPHA ramp: heavy on the LEFT (monogram
// nearly hidden — the soft "faded-left" look) easing to light on the RIGHT
// (monogram clearly visible). An OPAQUE base gradient underneath keeps the
// header's pink→purple background unchanged regardless of the veil. Values are
// 2-hex-digit alpha appended to the theme colours: DB≈0.86, A6≈0.65, 80≈0.50.
const FADE_LEFT_HEX = 'DB';
const FADE_MID_HEX = 'A6';
const FADE_RIGHT_HEX = '80';

type MotifName = 'messageSquare' | 'heart' | 'userRound' | 'compass' | 'map';

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
  messageSquare: { paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  heart: {
    paths: [
      'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    ],
  },
  userRound: { paths: ['M20 21a8 8 0 0 0-16 0'], circles: [[12, 8, 5]] },
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
  // Messages — square bubbles + sat-dot on a diagonal ("Diagonal Weave").
  'messages-weave': {
    tileW: 54,
    tileH: 54,
    transform: 'rotate(18)',
    // Raised 0.66 → 0.9 (#995) so the white monogram strokes read on-device.
    opacity: 0.9,
    motifs: [{ name: 'messageSquare', x: 5, y: 5, size: 26, filledDotAt: [42, 39] }],
  },
  // Friends — figure + heart alternating on a gentle rotation ("Rotated Monogram").
  'friends-rotated': {
    tileW: 58,
    tileH: 58,
    transform: 'rotate(14)',
    // Raised 0.68 → 0.9 (#995) so the white monogram strokes read on-device.
    opacity: 0.9,
    motifs: [
      { name: 'userRound', x: 5, y: 5, size: 22 },
      { name: 'heart', x: 34, y: 34, size: 17 },
    ],
  },
  // Explore — compass + folded map alternating on a gentle counter-rotation,
  // same two-motif rhythm as friends-rotated so the tabs read as one house.
  'explore-compass': {
    tileW: 58,
    tileH: 58,
    transform: 'rotate(-12)',
    // Raised 0.68 → 0.9 (#995) so the white monogram strokes read on-device.
    opacity: 0.9,
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
  const cfg = VARIANTS[variant];
  const patternId = `bp-${variant}`;

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.brandPink }, style]}
      pointerEvents="none"
    >
      {/* Opaque base gradient — the header background. Keeps the pink→purple
          wash intact so the alpha veil layered OVER the monogram (rendered
          after the SVG, further down) can hide/reveal it horizontally without
          washing out the colour on the right. */}
      <LinearGradient
        colors={[colors.brandPink, colors.brandGradientMid, colors.brandPurple]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
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
                .filter(
                  (m): m is MotifInstance & { filledDotAt: [number, number] } =>
                    m.filledDotAt != null,
                )
                .map((m, i) => (
                  <Circle
                    key={`dot${i}`}
                    cx={m.filledDotAt[0]}
                    cy={m.filledDotAt[1]}
                    r={1.6}
                    fill={STROKE}
                  />
                ))}
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>
      {/* Alpha-ramped veil OVER the monogram: opaque-ish pink on the left
          (hides the motifs) → lighter purple on the right (reveals them). This
          is what produces the faded-left → visible-right monogram. */}
      <LinearGradient
        colors={[
          `${colors.brandPink}${FADE_LEFT_HEX}`,
          `${colors.brandGradientMid}${FADE_MID_HEX}`,
          `${colors.brandPurple}${FADE_RIGHT_HEX}`,
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

export default BrandPatternBackground;
