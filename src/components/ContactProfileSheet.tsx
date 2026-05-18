import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import ContactProfileBody, { ContactProfileBodyData } from './ContactProfileBody';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

// Kept as a sibling of the new ContactProfileScreen so any host that
// still wants the sheet form (e.g. fallbacks for surfaces where a full
// route push would be heavy) can present it. New entry points should
// navigate to ContactProfile instead — see issue #435.
interface Props {
  visible: boolean;
  onClose: () => void;
  contact: ContactProfileBodyData | null;
  onZap?: () => void;
  onMessage?: () => void;
  /** Whether the user can actually send a zap (wallet attached + contact
   * has a Lightning address). When false, the zap button still renders
   * but in a disabled state with `zapDisabledReason` surfaced in the
   * accessibility label. */
  canZap?: boolean;
  zapDisabledReason?: string;
  // Optional drill-in: closes the sheet then navigates to the full
  // ContactProfile route. Renders a "View profile" pill in the sheet
  // body when wired up.
  onViewFullProfile?: () => void;
}

const ContactProfileSheet: React.FC<Props> = ({
  visible,
  onClose,
  contact,
  onZap,
  onMessage,
  canZap = false,
  zapDisabledReason,
  onViewFullProfile,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // 80% snap so the QR + action row + lud16 row all fit without scroll.
  const snapPoints = useMemo(() => ['80%'], []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  if (!contact) return null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleComponent={() => null}
    >
      <BottomSheetView>
        <ContactProfileBody
          contact={contact}
          onZap={onZap}
          onMessage={onMessage}
          canZap={canZap}
          zapDisabledReason={zapDisabledReason}
          onViewFullProfile={onViewFullProfile}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
  });

export default ContactProfileSheet;
