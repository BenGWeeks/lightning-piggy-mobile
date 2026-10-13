import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Text, TouchableOpacity, View } from 'react-native';
import { Info } from 'lucide-react-native';
import { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSafeExternalLink } from '../hooks/useSafeExternalLink';
import { createNetworkSectionStyles } from '../styles/NetworkSection.styles';

export default function NetworkSectionHeading({
  title,
  explanation,
  spec,
  testID,
}: {
  title: string;
  explanation: string;
  spec?: string;
  testID: string;
}) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNetworkSectionStyles(colors), [colors]);
  const sheet = useRef<BottomSheetModal>(null);
  const openLink = useSafeExternalLink();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheet.current?.dismiss();
      return true;
    });
    return () => sub.remove();
  }, [open]);
  return (
    <>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>{title}</Text>
        <TouchableOpacity
          testID={`${testID}-info`}
          accessibilityRole="button"
          accessibilityLabel={t('networkInfo.aboutSection', { title })}
          hitSlop={8}
          onPress={() => {
            setOpen(true);
            sheet.current?.present();
          }}
        >
          <Info size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
      <BottomSheetModal
        ref={sheet}
        onDismiss={() => setOpen(false)}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
        )}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetView style={styles.sheet} testID={`${testID}-info-sheet`}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Text style={styles.sheetText}>{explanation}</Text>
          {spec && (
            <TouchableOpacity
              testID={`${testID}-spec`}
              accessibilityRole="link"
              accessibilityLabel={t('networkInfo.readSpec')}
              onPress={() => openLink(spec)}
            >
              <Text style={styles.link}>{t('networkInfo.readSpec')}</Text>
            </TouchableOpacity>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    </>
  );
}
