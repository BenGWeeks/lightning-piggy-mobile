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
