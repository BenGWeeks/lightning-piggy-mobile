import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

const ZapIcon: React.FC<Props> = ({ size = 20, color = '#EC008C' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={color} />
  </Svg>
);

export default ZapIcon;
