import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/** Bold downward arrow — Lucide-style */
export const ArrowDownIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#EC008C',
  strokeWidth = 3,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 5v14M5 12l7 7 7-7"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Bold upward arrow — Lucide-style */
export const ArrowUpIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#EC008C',
  strokeWidth = 3,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 19V5M5 12l7-7 7 7"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Bold left-right arrow — Lucide-style */
export const ArrowLeftRightIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#EC008C',
  strokeWidth = 3,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Lightning bolt — Lucide Zap style */
export const LightningIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#F7931A',
  strokeWidth = 2.5,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Chain link — Lucide Link style */
export const ChainIcon: React.FC<IconProps> = ({
  size = 24,
  color = '#F7931A',
  strokeWidth = 2.5,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);
