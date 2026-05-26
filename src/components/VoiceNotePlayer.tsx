import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Play, Pause, AlertCircle } from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { writeAsStringAsync, cacheDirectory } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { formatTime } from '../utils/messageContent';
import { decryptFile } from '../services/encryptedFile';

const BARS = 40;

/**
 * Inline voice-note player for chat bubbles (#235) — sender AND receiver.
 *
 * Two playback modes:
 *  - **Plain** (`encrypted=false`): legacy / unencrypted notes — stream the
 *    URL directly via expo-audio.
 *  - **Encrypted** (`encrypted=true`, NIP-17 kind 15): on first play, fetch
 *    the AES-256-GCM ciphertext from Blossom, decrypt with the key/nonce
 *    (carried inside the E2E DM), write the plaintext to a cache file, and
 *    play that. The Blossom server only ever holds ciphertext.
 *
 * The waveform is a deterministic pseudo-wave seeded from the URL — like
 * WhatsApp's bubble, decorative but stable per-clip, scrubbed by playback.
 */
function pseudoWave(seed: string, bars: number): number[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    // 0.2 .. 1.0 so bars never collapse to a flat line.
    out.push(0.2 + (((h >>> 8) % 1000) / 1000) * 0.8);
  }
  return out;
}

const fmtDuration = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
};

// Extension for the decrypted cache file, from the file-type mime, so the
// player gets the right container hint. Defaults to m4a (our recorder).
function extFromMime(mime?: string): string {
  switch (mime) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/aac':
      return 'aac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
    default:
      return 'm4a';
  }
}

interface Props {
  url: string;
  fromMe: boolean;
  createdAt: number;
  senderName?: string | null;
  /** Encrypted (NIP-17 kind 15) → fetch ciphertext + decrypt before play. */
  encrypted?: boolean;
  keyHex?: string;
  nonceHex?: string;
  mime?: string;
  testID?: string;
}

const VoiceNotePlayer: React.FC<Props> = ({
  url,
  fromMe,
  createdAt,
  senderName,
  encrypted = false,
  keyHex,
  nonceHex,
  mime,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bars = useMemo(() => pseudoWave(url, BARS), [url]);

  // Decrypted clip is written to a cache file on first play; for plain notes
  // we stream the URL directly.
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const wantPlayRef = useRef(false);

  const source = encrypted ? localUri : url;
  const player = useAudioPlayer(source ?? undefined);
  const status = useAudioPlayerStatus(player);
  const isPlaying = status?.playing ?? false;
  const duration = status?.duration && isFinite(status.duration) ? status.duration : 0;
  const current = status?.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const playedBars = Math.round(progress * bars.length);

  // Fetch ciphertext → decrypt → write a playable cache file. Returns the
  // local uri (or null on failure). No-op (returns the url) for plain notes.
  const ensureLocal = useCallback(async (): Promise<string | null> => {
    if (!encrypted) return url;
    if (localUri) return localUri;
    if (!keyHex || !nonceHex) {
      setFailed(true);
      return null;
    }
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const cipher = new Uint8Array(await res.arrayBuffer());
      const plain = decryptFile(cipher, keyHex, nonceHex);
      const safe = (url.split('/').pop() ?? 'note').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!cacheDirectory) throw new Error('No cache directory available for decrypted audio');
      const base = cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
      const uri = `${base}lp-voice-${safe}.${extFromMime(mime)}`;
      await writeAsStringAsync(uri, Buffer.from(plain).toString('base64'), {
        encoding: 'base64',
      });
      setLocalUri(uri);
      return uri;
    } catch (e) {
      console.warn('[VoiceNotePlayer] decrypt/playback prep failed:', e);
      setFailed(true);
      return null;
    } finally {
      setBusy(false);
    }
  }, [encrypted, url, localUri, keyHex, nonceHex]);

  // Once the decrypted file lands and the user had asked to play, start it
  // (the player's source only switches to `localUri` on the next render).
  useEffect(() => {
    if (encrypted && localUri && wantPlayRef.current) {
      wantPlayRef.current = false;
      player.play();
    }
  }, [localUri, encrypted, player]);

  const onToggle = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (isPlaying) {
        player.pause();
        return;
      }
      if (encrypted && !localUri) {
        wantPlayRef.current = true;
        await ensureLocal(); // playback fires from the effect once decrypted
        return;
      }
      if (duration > 0 && current >= duration - 0.05) player.seekTo(0);
      player.play();
    } catch {
      // Playback is best-effort; a failed load just leaves the button idle.
    }
  }, [isPlaying, player, current, duration, encrypted, localUri, ensureLocal]);

  // On-bubble colours: white-on-pink for my bubbles, themed for theirs.
  const fg = fromMe ? colors.white : colors.textBody;
  const playBg = fromMe ? colors.white : colors.brandPink;
  const playFg = fromMe ? colors.brandPink : colors.white;
  const playedColor = fromMe ? colors.white : colors.brandPink;
  const unplayedColor = fromMe ? 'rgba(255,255,255,0.45)' : colors.divider;

  const timeLabel = fmtDuration(isPlaying ? current : duration);

  return (
    <View style={[styles.row, fromMe ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.bubble, fromMe ? styles.bubbleMe : styles.bubbleThem]}>
        {senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null}
        <Text
          style={[
            styles.title,
            { color: fromMe ? 'rgba(255,255,255,0.9)' : colors.textSupplementary },
          ]}
        >
          {encrypted ? 'Encrypted voice note' : 'Voice note'}
        </Text>
        <View
          style={styles.playerRow}
          accessibilityLabel={fromMe ? 'Voice note sent' : 'Voice note received'}
          testID={testID}
        >
          <TouchableOpacity
            style={[styles.playBtn, { backgroundColor: playBg }]}
            onPress={onToggle}
            disabled={busy}
            accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
            testID={testID ? `${testID}-toggle` : undefined}
          >
            {busy ? (
              <ActivityIndicator size="small" color={playFg} />
            ) : failed ? (
              <AlertCircle size={18} color={playFg} />
            ) : isPlaying ? (
              <Pause size={18} color={playFg} fill={playFg} />
            ) : (
              <Play size={18} color={playFg} fill={playFg} />
            )}
          </TouchableOpacity>
          <View style={styles.waveRow}>
            {bars.map((v, i) => (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: 4 + v * 24,
                    backgroundColor: i < playedBars ? playedColor : unplayedColor,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.duration, { color: fg }]}>{failed ? '--:--' : timeLabel}</Text>
        </View>
        <Text style={[styles.time, fromMe ? styles.timeMe : styles.timeThem]}>
          {formatTime(createdAt)}
        </Text>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', marginVertical: 2 },
    rowLeft: { justifyContent: 'flex-start' },
    rowRight: { justifyContent: 'flex-end' },
    // width 240 (outer) + 14px horizontal padding = exactly the invoiceCard /
    // contact-card footprint, so all three cards line up.
    bubble: {
      width: 240,
      maxWidth: '85%',
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bubbleMe: { backgroundColor: colors.brandPink, borderBottomRightRadius: 4 },
    bubbleThem: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
    senderLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      marginBottom: 4,
    },
    title: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    playBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    waveRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 30,
    },
    bar: { width: 3, borderRadius: 2, minHeight: 4 },
    duration: {
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      minWidth: 34,
      textAlign: 'right',
    },
    time: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
    timeMe: { color: 'rgba(255,255,255,0.8)' },
    timeThem: { color: colors.textSupplementary },
  });

export default VoiceNotePlayer;
