import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, ActivityIndicator } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createDecryptedImageStyles } from '../styles/DecryptedImage.styles';
import {
  DecryptedMediaCancelledError,
  peekDecryptedMedia,
  resolveDecryptedMedia,
} from '../services/decryptedMediaCache';
import type { MarmotImageParams } from '../utils/messageContent';

/**
 * Renders an inline chat image that may be either plain or encrypted (#688):
 *
 *  - **Plain** (`encrypted=false`): legacy / unencrypted images (or images
 *    from other clients) — display the URL directly via `<Image>`.
 *  - **Encrypted** (`encrypted=true`, NIP-17 kind 15): fetch the
 *    AES-256-GCM ciphertext from Blossom, decrypt with the key/nonce carried
 *    inside the E2E DM, write the plaintext to a cache file, and display that
 *    `file://` URI. The Blossom server only ever holds ciphertext.
 *
 * Mirrors VoiceNotePlayer's fetch→`decryptFile`→cache-file flow. We use a
 * cache file (not a base64 `data:` URI) so the decrypted bytes don't live as a
 * multi-MB JS string — base64 adds ~33% and would double again when handed to
 * the fullscreen viewer (Copilot review on #729). **Decrypt-once:** the
 * shared `decryptedMediaCache` keeps the resolved URI in memory and on disk,
 * keyed by URL + key material and scoped to the active account (wiped on
 * sign-out, #1241), so re-renders, scrolls, remounts and the fullscreen viewer
 * reuse it without re-fetching/re-decrypting (Ben's review note on #729).
 */
interface Props {
  url: string;
  encrypted: boolean;
  keyHex?: string;
  nonceHex?: string;
  mime?: string;
  /** A Marmot (MIP-04) photo: decrypted with these instead of `keyHex`. */
  marmot?: MarmotImageParams;
  /** Style applied to the rendered <Image>. */
  style?: React.ComponentProps<typeof Image>['style'];
  accessibilityLabel?: string;
  /** Reports the displayable URI once resolved (the cache `file://` URI for
   *  encrypted images), so a parent can wire a fullscreen tap to the decrypted
   *  image rather than the ciphertext blob URL. */
  onResolved?: (uri: string) => void;
}

const DecryptedImage: React.FC<Props> = ({
  url,
  encrypted,
  keyHex,
  nonceHex,
  mime,
  marmot,
  style,
  accessibilityLabel,
  onResolved,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createDecryptedImageStyles(colors), [colors]);

  // For plain images we feed the URL straight to <Image>. For encrypted ones
  // we resolve a cache `file://` URI after fetch+decrypt; seed from the cache
  // so an already-decrypted image shows instantly with no spinner.
  const [localUri, setLocalUri] = useState<string | null>(() =>
    encrypted ? peekDecryptedMedia({ url, kind: 'image', mime, keyHex, nonceHex, marmot }) : null,
  );
  const [failed, setFailed] = useState(false);
  // parseImageMessage builds a fresh `marmot` object every render; key the
  // effect on its content so a re-render doesn't restart a decrypt.
  const marmotRef = useRef(marmot);
  marmotRef.current = marmot;
  const marmotSig = marmot ? `${marmot.ciphertextSha256}:${marmot.keysHex.join(',')}` : '';

  useEffect(() => {
    if (!encrypted) return;
    const marmotParams = marmotRef.current;
    if ((!keyHex && !marmotParams) || !nonceHex) {
      setFailed(true);
      return;
    }
    const ref = { url, kind: 'image' as const, mime, keyHex, nonceHex, marmot: marmotParams };
    // Already decrypted this session → reuse immediately, no work.
    const memo = peekDecryptedMedia(ref);
    if (memo) {
      setLocalUri(memo);
      onResolved?.(memo);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setLocalUri(null);
    resolveDecryptedMedia(ref).then(
      (uri) => {
        if (cancelled) return;
        setLocalUri(uri);
        onResolved?.(uri);
      },
      (e) => {
        // Cancelled = the account changed or its cache was wiped mid-decrypt;
        // this bubble is on its way out, so don't flag it as broken.
        if (cancelled || e instanceof DecryptedMediaCancelledError) return;
        console.warn('[DecryptedImage] decrypt failed:', e);
        setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [encrypted, url, keyHex, nonceHex, mime, marmotSig, onResolved]);

  if (failed) {
    return (
      <View style={[style, styles.center]}>
        <AlertCircle size={28} color={colors.textSupplementary} />
      </View>
    );
  }

  // Encrypted + still decrypting → spinner placeholder at the image footprint.
  if (encrypted && !localUri) {
    return (
      <View style={[style, styles.center]}>
        <ActivityIndicator size="small" color={colors.brandPink} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: encrypted ? (localUri as string) : url }}
      style={style}
      resizeMode="cover"
      accessibilityLabel={accessibilityLabel}
    />
  );
};

export default DecryptedImage;
