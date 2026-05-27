import React, { useEffect, useMemo, useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { Buffer } from 'buffer';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { decryptFile } from '../services/encryptedFile';

/**
 * Renders an inline chat image that may be either plain or encrypted (#688):
 *
 *  - **Plain** (`encrypted=false`): legacy / unencrypted images (or images
 *    from other clients) — display the URL directly via `<Image>`.
 *  - **Encrypted** (`encrypted=true`, NIP-17 kind 15): fetch the
 *    AES-256-GCM ciphertext from Blossom, decrypt with the key/nonce carried
 *    inside the E2E DM, and display the plaintext bytes as a `data:` URI. The
 *    Blossom server only ever holds ciphertext.
 *
 * Mirrors VoiceNotePlayer's fetch→`decryptFile` flow. A data URI (rather than
 * a cache file) keeps the decrypted bytes in memory only — nothing touches
 * disk — which is the right default for image previews.
 */
interface Props {
  url: string;
  encrypted: boolean;
  keyHex?: string;
  nonceHex?: string;
  mime?: string;
  /** Style applied to the rendered <Image>. */
  style?: React.ComponentProps<typeof Image>['style'];
  accessibilityLabel?: string;
  /** Reports the displayable URI once resolved (the data: URI for encrypted
   *  images), so a parent can wire a fullscreen tap to the decrypted bytes
   *  rather than the ciphertext blob URL. */
  onResolved?: (uri: string) => void;
}

const DecryptedImage: React.FC<Props> = ({
  url,
  encrypted,
  keyHex,
  nonceHex,
  mime,
  style,
  accessibilityLabel,
  onResolved,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // For plain images we feed the URL straight to <Image>. For encrypted ones
  // we resolve a `data:` URI after fetch+decrypt; null until then.
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!encrypted) return;
    if (!keyHex || !nonceHex) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setDataUri(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const cipher = new Uint8Array(await res.arrayBuffer());
        const plain = decryptFile(cipher, keyHex, nonceHex);
        const b64 = Buffer.from(plain).toString('base64');
        const uri = `data:${mime || 'image/jpeg'};base64,${b64}`;
        if (!cancelled) {
          setDataUri(uri);
          onResolved?.(uri);
        }
      } catch (e) {
        console.warn('[DecryptedImage] decrypt failed:', e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [encrypted, url, keyHex, nonceHex, mime, onResolved]);

  if (failed) {
    return (
      <View style={[style, styles.center]}>
        <AlertCircle size={28} color={colors.textSupplementary} />
      </View>
    );
  }

  // Encrypted + still decrypting → spinner placeholder at the image footprint.
  if (encrypted && !dataUri) {
    return (
      <View style={[style, styles.center]}>
        <ActivityIndicator size="small" color={colors.brandPink} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: encrypted ? (dataUri as string) : url }}
      style={style}
      resizeMode="cover"
      accessibilityLabel={accessibilityLabel}
    />
  );
};

const createStyles = (_colors: Palette) =>
  StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center' },
  });

export default DecryptedImage;
