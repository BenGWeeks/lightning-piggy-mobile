import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Play, Pause } from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { formatTime } from '../utils/messageContent';

const BARS = 28;

/**
 * Inline voice-note player for chat bubbles (#235) — sender AND receiver.
 *
 * The waveform is a deterministic pseudo-wave seeded from the URL: a
 * received note carries no real loudness samples (those are only captured
 * on the recording device), so — exactly like WhatsApp's bubble — the
 * wave is decorative but stable per-clip, and the playback head scrubs it.
 *
 * Streams the remote URL via expo-audio. Today the blob is fetched in the
 * clear from Blossom (the URL itself rides inside the NIP-17 encrypted DM);
 * if/when we encrypt blobs or move to a private/family Blossom, only this
 * fetch + a decrypt step would change.
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

interface Props {
  url: string;
  fromMe: boolean;
  createdAt: number;
  senderName?: string | null;
  testID?: string;
}

const VoiceNotePlayer: React.FC<Props> = ({ url, fromMe, createdAt, senderName, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bars = useMemo(() => pseudoWave(url, BARS), [url]);

  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const isPlaying = status?.playing ?? false;
  const duration = status?.duration && isFinite(status.duration) ? status.duration : 0;
  const current = status?.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const playedBars = Math.round(progress * bars.length);

  const onToggle = useCallback(async () => {
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (isPlaying) {
        player.pause();
      } else {
        if (duration > 0 && current >= duration - 0.05) player.seekTo(0);
        player.play();
      }
    } catch {
      // Playback is best-effort; a failed load just leaves the button idle.
    }
  }, [isPlaying, player, current, duration]);

  // On-bubble colours: white-on-pink for my bubbles, themed for theirs.
  const fg = fromMe ? colors.white : colors.textBody;
  const playBg = fromMe ? colors.white : colors.brandPink;
  const playFg = fromMe ? colors.brandPink : colors.white;
  const playedColor = fromMe ? colors.white : colors.brandPink;
  const unplayedColor = fromMe ? 'rgba(255,255,255,0.45)' : colors.divider;

  // Live playback time while playing; total length otherwise (once loaded).
  const timeLabel = fmtDuration(isPlaying ? current : duration);

  return (
    <View style={[styles.row, fromMe ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.bubble, fromMe ? styles.bubbleMe : styles.bubbleThem]}>
        {senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null}
        <View
          style={styles.playerRow}
          accessibilityLabel={fromMe ? 'Voice note sent' : 'Voice note received'}
          testID={testID}
        >
          <TouchableOpacity
            style={[styles.playBtn, { backgroundColor: playBg }]}
            onPress={onToggle}
            accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
            testID={testID ? `${testID}-toggle` : undefined}
          >
            {isPlaying ? (
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
          <Text style={[styles.duration, { color: fg }]}>{timeLabel}</Text>
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
    row: { flexDirection: 'row', marginVertical: 3, paddingHorizontal: 12 },
    rowLeft: { justifyContent: 'flex-start' },
    rowRight: { justifyContent: 'flex-end' },
    bubble: {
      maxWidth: '82%',
      minWidth: 240,
      borderRadius: 18,
      paddingHorizontal: 12,
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
    playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    playBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 30 },
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
