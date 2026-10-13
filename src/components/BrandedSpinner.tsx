import React, { useMemo } from 'react';
import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createBrandedSpinnerStyles } from '../styles/BrandedSpinner.styles';

export interface BrandedSpinnerProps extends Omit<ActivityIndicatorProps, 'color' | 'size'> {
  size?: 'small' | 'large';
  /** White foreground for the brand gradient or a filled brand button. */
  onGradient?: boolean;
}

function BrandedSpinner({
  size = 'small',
  onGradient = false,
  style,
  testID = 'branded-spinner',
  accessibilityLabel,
  ...props
}: BrandedSpinnerProps) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createBrandedSpinnerStyles(colors), [colors]);
  return (
    <ActivityIndicator
      {...props}
      size={size}
      color={onGradient ? colors.white : colors.brandPink}
      style={[styles[size], style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? t('messageBubble.loading')}
    />
  );
}

export default React.memo(BrandedSpinner);
