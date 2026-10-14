import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Send, Share2 } from 'lucide-react-native';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketListingActionsStyles } from '../styles/MarketListingActions.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSendToFriend: () => void;
  onShareLink: () => void;
}

/** The product page's share options (#1541): a friend (NIP-17 DM) or the OS share sheet. */
const MarketShareSheet: React.FC<Props> = ({ visible, onClose, onSendToFriend, onShareLink }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketListingActionsStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  // Run the action just after the dismiss so the next sheet has room.
  const handle = (action: () => void) => () => {
    onClose();
    setTimeout(action, 50);
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: colors.divider }}
      backgroundStyle={{ backgroundColor: colors.surface }}
    >
      <BottomSheetView style={styles.sheet} testID="market-share-sheet">
        <Text style={styles.sheetTitle}>{t('market.share.title')}</Text>
        <TouchableOpacity
          style={styles.sheetRow}
          onPress={handle(onSendToFriend)}
          testID="market-share-friend"
          accessibilityRole="button"
          accessibilityLabel={t('market.share.sendToFriend')}
        >
          <Send size={22} color={colors.brandPink} />
          <Text style={styles.sheetRowText}>{t('market.share.sendToFriend')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sheetRow}
          onPress={handle(onShareLink)}
          testID="market-share-link"
          accessibilityRole="button"
          accessibilityLabel={t('market.share.shareLink')}
        >
          <Share2 size={22} color={colors.brandPink} />
          <Text style={styles.sheetRowText}>{t('market.share.shareLink')}</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default MarketShareSheet;
