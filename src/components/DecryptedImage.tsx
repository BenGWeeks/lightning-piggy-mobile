import React, { useEffect, useMemo, useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { writeAsStringAsync, getInfoAsync, cacheDirectory } from 'expo-file-system/legacy';
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
 *    inside the E2E DM, write the plaintext to a cache file, and display that
 *    `file://` URI. The Blossom server only ever holds ciphertext.
 *
 * Mirrors VoiceNotePlayer's fetch→`decryptFile`→cache-file flow. We use a
 * cache file (not a base64 `data:` URI) so the decrypted bytes don't live as a
 * multi-MB JS string — base64 adds ~33% and would double again when handed to
 * the fullscreen viewer (Copilot review on #729). **Decrypt-once:** the
 * resolved URI is cached by source URL both in memory and on disk (Blossom URLs
 * are content-addressed — sha256 of the ciphertext — and each send uses a fresh
 * key, so the URL uniquely identifies the bytes), so re-renders, scrolls,
 * remounts and the fullscreen viewer reuse it without re-fetching/re-decrypting
 * (Ben's review note on #729). We deliberately do NOT delete on unmount (so it
 * stays reusable); `cacheDirectory` is OS-evictable, which bounds disk use.
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
  /** Reports the displayable URI once resolved (the cache `file://` URI for
   *  encrypted images), so a parent can wire a fullscreen tap to the decrypted
   *  image rather than the ciphertext blob URL. */
  onResolved?: (uri: string) => void;
}

// Source ciphertext URL → decrypted-file `file://` URI. Module-scoped so a
// decrypted image is reused across every bubble/mount in the session.
const decryptedUriCache = new Map<string, string>();

/** Stable cache-file path for a ciphertext URL. `||` not `??`: a trailing-slash
 *  URL makes `.pop()` return '' (not null), which would collide across images. */
function cacheFileFor(url: string, mime?: string): string | null {
  if (!cacheDirectory) return null;
  const base = cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
  const safe = (url.split('/').pop() || 'img').replace(/[^a-zA-Z0-9._-]/g, '');
  const ext = (mime || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  return `${base}lp-img-${safe}.${ext}`;
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
  // we resolve a cache `file://` URI after fetch+decrypt; seed from the cache
  // so an already-decrypted image shows instantly with no spinner.
  const [localUri, setLocalUri] = useState<string | null>(
    encrypted ? (decryptedUriCache.get(url) ?? null) : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!encrypted) return;
    if (!keyHex || !nonceHex) {
      setFailed(true);
      return;
    }
    // Already decrypted this session → reuse immediately, no work.
    const memo = decryptedUriCache.get(url);
    if (memo) {
      setLocalUri(memo);
      onResolved?.(memo);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setLocalUri(null);
    (async () => {
      try {
        const target = cacheFileFor(url, mime);
        if (!target) throw new Error('no cache directory available');
        // Reuse a file decrypted on a previous mount if it's still on disk —
        // decrypt once, even across remounts (Ben's review note on #729).
        const info = await getInfoAsync(target);
        if (!info.exists) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const cipher = new Uint8Array(await res.arrayBuffer());
          const plain = decryptFile(cipher, keyHex, nonceHex);
          await writeAsStringAsync(target, Buffer.from(plain).toString('base64'), {
            encoding: 'base64',
          });
        }
        decryptedUriCache.set(url, target);
        if (!cancelled) {
          setLocalUri(target);
          onResolved?.(target);
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

const createStyles = (_colors: Palette) =>
  StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center' },
  });

export default DecryptedImage;
