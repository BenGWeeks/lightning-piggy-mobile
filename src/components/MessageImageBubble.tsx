import React, { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useLocale } from '../contexts/LocaleContext';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';
import type { ParsedImageMessage } from '../utils/messageContent';
import { isPublicHttpUrl } from '../utils/publicUrl';
import { useTapToReveal } from '../hooks/useTapToReveal';
import DecryptedImage from './DecryptedImage';
import TapToLoadMedia, { displayHost } from './TapToLoadMedia';

interface Props {
  styles: MessageBubbleStyles;
  image: ParsedImageMessage;
  /** Message id — keys the tap-to-load state and the placeholder testID. */
  messageId: string;
  testIdPrefix: string;
  fromMe: boolean;
  /** Sender is me or someone I follow (#1338). Otherwise the image waits for a tap. */
  autoLoad: boolean;
  senderLabel: React.ReactNode;
  onOpenImageFullscreen?: (url: string) => void;
  // Long-press → parent's MessageActionsSheet (#205). Kept firing even when
  // there's no fullscreen tap handler, so the pressable is only disabled when
  // BOTH the tap and the long-press are absent.
  onLongPress?: () => void;
  testID: string;
  // Shared time + delivery-tick footer (#856). Passed in so a sent image shows
  // the tick like every other variant.
  footer: React.ReactNode;
}

/**
 * Image bubble (#688). Lives in its own component because the encrypted
 * branch needs render state (the resolved displayable URI for the fullscreen
 * tap) — a hook can't be called from inside MessageBubble's body, which has
 * earlier conditional returns. Renders DecryptedImage, which handles both the
 * plain-URL and fetch-ciphertext→decrypt paths.
 *
 * Trust gating (#1338): the image URL is chosen by the sender, so it only
 * loads automatically when the sender is trusted AND the URL is a public
 * address. Otherwise a tap-to-load placeholder shows the host, and nothing is
 * requested (DecryptedImage isn't even mounted) until the reader taps.
 */
const MessageImageBubble: React.FC<Props> = ({
  styles,
  image,
  messageId,
  testIdPrefix,
  fromMe,
  autoLoad,
  senderLabel,
  onOpenImageFullscreen,
  onLongPress,
  testID,
  footer,
}) => {
  const { t } = useLocale();
  const [loadAllowed, reveal] = useTapToReveal(
    `image:${messageId}`,
    autoLoad && isPublicHttpUrl(image.url),
  );
  // For plain images the fetchable URL is the display source; for encrypted
  // ones DecryptedImage resolves a data: URI, which it reports back here so
  // the fullscreen tap shows the decrypted image, not the ciphertext blob.
  const [displayUri, setDisplayUri] = useState<string | null>(image.encrypted ? null : image.url);
  const canOpen = loadAllowed && !!onOpenImageFullscreen && !!displayUri;
  // Until revealed, a tap loads the image; long-press still opens the menu.
  const onPress = loadAllowed ? () => displayUri && onOpenImageFullscreen?.(displayUri) : reveal;
  return (
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.imageBubble, fromMe ? styles.imageBubbleMe : styles.imageBubbleThem]}
        accessibilityLabel={
          !loadAllowed
            ? t('messageBubble.loadImageA11y', { host: displayHost(image.url) })
            : fromMe
              ? t('messageBubble.imageSent')
              : t('messageBubble.imageReceived')
        }
        // Announce as an image-button whenever it's interactive — either it can
        // open fullscreen (tap) OR it can open the actions sheet (long-press).
        // Only a purely-static image announces as a plain 'image'.
        accessibilityRole={
          !loadAllowed ? 'button' : canOpen || onLongPress ? 'imagebutton' : 'image'
        }
        disabled={loadAllowed && !canOpen && !onLongPress}
        testID={testID}
      >
        {senderLabel}
        {loadAllowed ? (
          <DecryptedImage
            url={image.url}
            encrypted={image.encrypted}
            keyHex={image.keyHex}
            nonceHex={image.nonceHex}
            mime={image.mime}
            marmot={image.marmot}
            style={styles.imageBubbleImage}
            accessibilityLabel={t('messageBubble.sharedImage')}
            onResolved={image.encrypted ? setDisplayUri : undefined}
          />
        ) : (
          <TapToLoadMedia
            variant="image"
            url={image.url}
            fromMe={fromMe}
            testID={`${testIdPrefix}-image-placeholder-${messageId}`}
          />
        )}
        {footer}
      </TouchableOpacity>
    </View>
  );
};

export default MessageImageBubble;
