import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

export type SpecOption = { label: string; description: string; isCurrent: boolean };

export type CacheSpecInfo = { title: string; body: string; options?: SpecOption[] };

interface Props {
  spec: CacheSpecInfo | null;
  onClose: () => void;
}

/**
 * Explainer popup for a cache's spec chips / D-T-S meters. Mirrors the
 * Receive sheet pattern (BottomSheetModal + backdrop). When `spec` has
 * `options`, the full vocabulary for that field is listed with the
 * cache's current value highlighted.
 */
const CacheSpecSheet: React.FC<Props> = ({ spec, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (spec) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [spec]);

  // Android hardware back closes the sheet rather than the whole screen.
  useEffect(() => {
    if (!spec) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [spec, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: colors.divider }}
      backgroundStyle={{ backgroundColor: colors.background }}
    >
      <BottomSheetView style={styles.body}>
        {spec ? (
          <>
            <Text style={styles.title}>{spec.title}</Text>
            <Text style={styles.bodyText}>{spec.body}</Text>
            {spec.options ? (
              <View style={styles.options}>
                {spec.options.map((opt) => (
                  <View
                    key={opt.label}
                    style={[styles.option, opt.isCurrent && styles.optionCurrent]}
                  >
                    <Text style={[styles.optionLabel, opt.isCurrent && styles.optionLabelCurrent]}>
                      {opt.label}
                      {opt.isCurrent ? ' · current' : ''}
                    </Text>
                    <Text style={styles.optionDesc}>{opt.description}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    body: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 32,
      gap: 8,
    },
    title: { fontSize: 18, fontWeight: '800', color: colors.textHeader },
    bodyText: { fontSize: 14, color: colors.textSupplementary, lineHeight: 20 },
    options: { gap: 6, marginTop: 6 },
    option: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    optionCurrent: { backgroundColor: colors.brandPinkLight },
    optionLabel: { fontSize: 13, fontWeight: '700', color: colors.textSupplementary },
    optionLabelCurrent: { color: colors.brandPink },
    optionDesc: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 16,
      marginTop: 1,
    },
  });

export default CacheSpecSheet;
