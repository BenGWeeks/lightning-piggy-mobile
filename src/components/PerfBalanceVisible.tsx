import { useLayoutEffect, useRef } from 'react';
import { Text, type TextProps } from 'react-native';
import { perfBalanceSource, perfBalanceVisible } from '../utils/perfBalance';

/** Same balance text, with layout/commit probes; used only in perf builds. */
export function PerfBalanceVisible({
  id,
  balance,
  ...props
}: TextProps & { id?: string; balance?: number | null }) {
  const laidOut = useRef(false);
  const source = id && balance != null ? perfBalanceSource(id, balance) : undefined;
  useLayoutEffect(() => {
    if (laidOut.current) perfBalanceVisible(source);
  }, [source]);
  return (
    <Text
      {...props}
      onLayout={() => {
        laidOut.current = true;
        perfBalanceVisible(source);
      }}
    />
  );
}
