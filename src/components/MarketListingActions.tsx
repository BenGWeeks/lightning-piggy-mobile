import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Heart, Share2 } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketListingActionsStyles } from '../styles/MarketListingActions.styles';
import { useListingLike } from '../hooks/useListingLike';
import { useListingShare } from '../hooks/useListingShare';
import MarketShareSheet from './MarketShareSheet';
import FriendPickerSheet from './FriendPickerSheet';
import type { MarketProduct } from '../data/marketProducts';

interface Props {
  product: MarketProduct;
  onRequestSignIn: () => void;
}

/**
 * Like + Share for a Market listing (#1541), sitting at the right of the row
 * under the product image, like Amazon. Like is a public NIP-25 reaction on
 * the listing (with a like count); Share sends it to a friend or out through
 * the OS share sheet. Renders nothing for products that aren't kind-30402
 * Nostr listings (curated catalogue items have nothing to react to).
 */
const MarketListingActions: React.FC<Props> = ({ product, onRequestSignIn }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketListingActionsStyles(colors), [colors]);
  const like = useListingLike(product, onRequestSignIn);
  const share = useListingShare(product);
  const [shareOpen, setShareOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openPicker = useCallback(() => {
    if (share.signedIn) setPickerOpen(true);
    else onRequestSignIn();
  }, [share.signedIn, onRequestSignIn]);

  if (!like.available && !share.available) return null;

  return (
    <View style={styles.row} testID="market-listing-actions">
      {like.available ? (
        <TouchableOpacity
          style={styles.action}
          onPress={like.toggle}
          disabled={like.busy}
          testID="market-like-button"
          accessibilityRole="button"
          accessibilityLabel={like.liked ? t('market.like.unlike') : t('market.like.like')}
          accessibilityState={{ selected: like.liked, busy: like.busy }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Heart
            size={22}
            color={like.liked ? colors.brandPink : colors.textBody}
            fill={like.liked ? colors.brandPink : 'transparent'}
            strokeWidth={2.25}
          />
          {like.count ? (
            <Text style={styles.count} testID="market-like-count">
              {like.count}
            </Text>
          ) : null}
        </TouchableOpacity>
      ) : null}
      {share.available ? (
        <TouchableOpacity
          style={styles.action}
          onPress={() => setShareOpen(true)}
          testID="market-share-button"
          accessibilityRole="button"
          accessibilityLabel={t('market.share.share')}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Share2 size={22} color={colors.textBody} strokeWidth={2.25} />
        </TouchableOpacity>
      ) : null}

      {share.available ? (
        <>
          <MarketShareSheet
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
            onSendToFriend={openPicker}
            onShareLink={share.shareLink}
          />
          <FriendPickerSheet
            visible={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(friend) => {
              setPickerOpen(false);
              void share.sendToFriend(friend);
            }}
            title={t('market.share.pickerTitle')}
            subtitle={t('market.share.pickerSubtitle')}
          />
        </>
      ) : null}
    </View>
  );
};

export default MarketListingActions;
