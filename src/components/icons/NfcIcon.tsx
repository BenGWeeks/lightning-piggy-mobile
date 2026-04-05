import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

const NfcIcon: React.FC<Props> = ({ size = 24, color = '#EC008C' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* NFC contactless/tap symbol: radio waves from a device */}
    <Path
      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
      fill={color}
      opacity={0.3}
    />
    <Path d="M7 12c0-2.76 2.24-5 5-5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Path d="M5 12c0-3.87 3.13-7 7-7" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Path d="M3 12c0-4.97 4.03-9 9-9" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Path d="M12 12m-1.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0" fill={color} />
  </Svg>
);

export default NfcIcon;
