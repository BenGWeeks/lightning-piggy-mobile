import React, { useMemo } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';

type Props = Omit<RefreshControlProps, 'tintColor' | 'colors' | 'progressBackgroundColor'>;

export const brandedRefreshControlProps = (colors: Palette) => ({
  tintColor: colors.brandPink,
  colors: [colors.brandPink],
  progressBackgroundColor: colors.surface,
});

function BrandedRefreshControl({
  testID = 'branded-refresh-control',
  accessibilityLabel,
  ...props
}: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const brandedProps = useMemo(() => brandedRefreshControlProps(colors), [colors]);
  return (
    <RefreshControl
      {...props}
      {...brandedProps}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? t('messageBubble.loading')}
    />
  );
}

export default React.memo(BrandedRefreshControl);
