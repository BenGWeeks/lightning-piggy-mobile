import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler, Linking } from 'react-native';
import { Mic, Square, Send, X, Play, Pause } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { getInfoAsync } from 'expo-file-system/legacy';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Called once the user taps Send. The parent uploads `uri` to Blossom and
   * sends the resulting URL as the message body — same path as image / GIF
   * sends today (#235).
   */
  onSend: (uri: string) => void | Promise<void>;
  /**
   * When true, the Send button shows a spinner and stays disabled
   * while the parent's upload + post is in flight. Cancel only
   * dismisses the sheet — it does NOT abort an in-flight upload, so
   * a tap on Cancel during `sending` may still result in the voice
   * note posting once the parent's `onSend` resolves. (Aborting
   * an in-flight upload would require threading an AbortSignal
   * through `uploadBlob`, tracked as a follow-up.)
   */
  sending?: boolean;
}

const MAX_RECORDING_SECONDS = 60;

// Soft cap below typical Blossom server limits (often 25-100 MB) to
// fail fast with a friendly error rather than waste bandwidth on an
// upload the server will reject. Bump this when you know your default
// Blossom server's advertised limit is larger.
const MAX_VOICE_NOTE_SIZE_BYTES = 5 * 1024 * 1024;

// Fixed bar count for the WhatsApp-style review waveform. We average the
// captured metering samples into this many buckets so the wave looks
// consistent whether the clip is 2 s or 60 s.
const WAVEFORM_BARS = 40;

/**
 * Average a variable-length metering history (0-1 loudness samples
 * captured at ~5 Hz while recording) into a fixed number of bars.
 */
function bucketMetering(history: number[], bars: number): number[] {
  if (history.length === 0) return [];
  if (history.length <= bars) return history;
  const out: number[] = [];
  const size = history.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < history.length; j++) {
      sum += history[j];
      n += 1;
    }
    out.push(n ? sum / n : 0);
  }
  return out;
}

/**
 * WhatsApp-style waveform. `progress` (0-1) paints the played portion in
 * brand pink and the rest in the divider grey, so it doubles as a
 * playback scrubber. Decorative — the time label carries the duration.
 */
const Waveform: React.FC<{ data: number[]; progress: number; colors: Palette }> = ({
  data,
  progress,
  colors,
}) => {
  const bars = useMemo(() => bucketMetering(data, WAVEFORM_BARS), [data]);
  if (bars.length === 0) return null;
  const played = Math.round(progress * bars.length);
  return (
    <View style={waveStyles.row} accessibilityLabel="Voice note waveform">
      {bars.map((v, i) => (
        <View
          key={i}
          style={[
            waveStyles.bar,
            {
              height: 3 + v * 28,
              backgroundColor: i < played ? colors.brandPink : colors.divider,
            },
          ]}
        />
      ))}
    </View>
  );
};

const waveStyles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 34 },
  bar: { width: 3, borderRadius: 2, minHeight: 3 },
});

const fmtTime = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

/**
 * In-app voice-note recording sheet (#235). Tap-to-toggle: the big mic
 * button starts recording on first tap, switches to a stop icon while
 * recording, and the elapsed-time display + animated pulse confirm the
 * mic is live. A 60 second hard cap auto-stops the recording so the
 * resulting `.m4a` stays under ~1 MB.
 *
 * After stopping, a WhatsApp-style review row (play/pause + waveform +
 * time) lets the user listen back before sending. The waveform is built
 * from the loudness samples captured during recording.
 *
 * The sheet always recreates its hook recorder on mount (because the
 * parent unmounts it via `visible` flipping), so there's no leaked
 * recorder session across opens. Closing the sheet mid-recording calls
 * `recorder.stop()` to release the mic.
 *
 * Inline playback in the receiver's bubble is OUT OF SCOPE here — the
 * sender posts the Blossom URL as plain text, the receiver renders it
 * as a tappable link until a follow-up issue lands a player.
 */
const VoiceRecordingSheet: React.FC<Props> = ({ visible, onClose, onSend, sending = false }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // No explicit snapPoints — gorhom v5 defaults `enableDynamicSizing` to
  // true and sizes the sheet to its content intrinsically (BottomSheetView
  // measures the height). A literal 'CONTENT_HEIGHT' snap point is not a
  // valid value and the library throws on open, so we omit snapPoints
  // entirely (matches ContactProfileSheet / AccountSwitcherSheet).

  // The recorder hook re-uses the same native recorder across renders.
  // We poll its state at 200 ms — fast enough to drive a smooth
  // elapsed-seconds counter without thrashing the JS bridge. A separate
  // useAudioRecorder + useAudioRecorderState pair (vs. the
  // statusListener overload) keeps the hot path declarative — the
  // animated pulse below reads `state.metering` on every render tick.
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 200);

  // Track the recorded file URI captured at stop-time so the Send
  // handler doesn't race a still-finalising recorder. Cleared on every
  // open so a previous session's URI can't leak to a new send.
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  // Loudness samples (0-1) captured while recording — the source for the
  // review waveform. Reset on every open / re-record.
  const [meteringHistory, setMeteringHistory] = useState<number[]>([]);

  // Playback of the just-recorded clip so the user can listen back
  // before sending. Passing `undefined` while there's no recording keeps
  // the player idle; it loads the file once `recordedUri` is set.
  const player = useAudioPlayer(recordedUri ?? undefined);
  const playerStatus = useAudioPlayerStatus(player);
  const isPlaying = playerStatus?.playing ?? false;
  const playbackDuration =
    playerStatus?.duration && isFinite(playerStatus.duration) ? playerStatus.duration : 0;
  const playbackCurrent = playerStatus?.currentTime ?? 0;
  const playbackProgress =
    playbackDuration > 0 ? Math.min(1, playbackCurrent / playbackDuration) : 0;

  // Synchronous send guard. The parent's `sending` prop only flips
  // after onSend's first await, so a quick double-tap on Send can call
  // onSend twice before either screen re-renders. A ref flips
  // synchronously inside handleSend before the first await so the
  // second tap returns immediately.
  const sendInFlightRef = useRef(false);
  // Tracks whether we've ever started recording in this session — used
  // to gate the pulse animation and the "tap mic to record" hint.
  const [didStart, setDidStart] = useState(false);
  // True while we're awaiting a permission decision so the mic button
  // shows a disabled state instead of double-firing the prompt.
  const [requesting, setRequesting] = useState(false);

  // 60 s hard-cap timer. We don't rely on the recorder's internal
  // `stopOnReachingTimeLimit` (varies by platform) — JS-side timer is
  // simple, predictable, and easy to cancel on unmount.
  const cutoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const elapsedSeconds = Math.min(
    MAX_RECORDING_SECONDS,
    Math.floor(recorderState.durationMillis / 1000),
  );
  const isRecording = recorderState.isRecording;
  const isFinalised = !isRecording && !!recordedUri;

  // Time shown in the review row: live playback position while playing,
  // otherwise the clip's total length.
  const reviewTimeLabel = fmtTime(isPlaying ? playbackCurrent : playbackDuration || elapsedSeconds);

  // Animated pulse driven by the recorder's metering value. metering is
  // dB (negative; -160 is silence, 0 is clipping). Map to a 0-1 scale
  // and feed a withTiming so the indicator breathes smoothly rather
  // than snapping on every 200 ms tick. We also push the same 0-1 value
  // into `meteringHistory` so the review waveform mirrors what was said.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!isRecording) {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
      return;
    }
    const db = recorderState.metering ?? -60;
    // Squash -60 dB → 0, -10 dB → 1. Voice usually sits around -30 to
    // -10 in normal speech, so the visible range is in the comfortable
    // middle of the pulse curve.
    const normalized = Math.max(0, Math.min(1, (db + 60) / 50));
    pulse.value = withTiming(normalized, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
    setMeteringHistory((prev) => [...prev, normalized]);
  }, [recorderState.metering, isRecording, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.4 }],
    opacity: 0.25 + pulse.value * 0.6,
  }));

  // Open / dismiss the sheet in lockstep with the parent's `visible`
  // prop. We also reset session state on open (so a previous URI can't
  // be resent) and tear down any in-flight recording on close.
  useEffect(() => {
    if (visible) {
      setRecordedUri(null);
      setMeteringHistory([]);
      setDidStart(false);
      sendInFlightRef.current = false;
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  // Hardware back button → close. Mirrors the GifPickerSheet pattern so
  // the sheet behaves consistently with its siblings on Android.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Cancel + cleanup on unmount or visibility flip while recording.
  // Without this the native mic stays held open until the OS reclaims
  // it — visible as a system mic indicator that lingers after the
  // sheet has disappeared. Best-effort: we ignore errors because the
  // recorder may already be stopped from the user's last action.
  useEffect(() => {
    return () => {
      if (cutoffTimerRef.current) {
        clearTimeout(cutoffTimerRef.current);
        cutoffTimerRef.current = null;
      }
      // No await — unmount cleanup must be synchronous.
      recorder.stop().catch(() => {
        // Already stopped — fine.
      });
    };
    // recorder identity is stable across renders within a single mount
    // (useAudioRecorder caches it), so this effect runs only on
    // sheet-mount / sheet-unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) {
      Alert.alert(
        'Microphone access needed',
        'Lightning Piggy needs microphone permission to record voice notes. Open Settings to grant it.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return false;
    }
    setRequesting(true);
    let result;
    try {
      result = await requestRecordingPermissionsAsync();
    } finally {
      setRequesting(false);
    }
    if (!result.granted) {
      // First-time deny — surface the "Open Settings" path immediately
      // so the user doesn't have to tap the mic a second time to learn
      // how to recover. On Android the second prompt also auto-flips
      // canAskAgain to false; iOS only ever shows the OS prompt once.
      Alert.alert(
        'Microphone access needed',
        'Voice notes need microphone access. You can grant it any time from system Settings.',
        result.canAskAgain
          ? [{ text: 'OK', style: 'cancel' }]
          : [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
      );
      return false;
    }
    return true;
  }, []);

  const handleStart = useCallback(async () => {
    if (sending || requesting || isRecording) return;
    const ok = await ensurePermission();
    if (!ok) return;
    try {
      // Stop any review playback before we re-arm the mic.
      try {
        player.pause();
      } catch {
        // No active playback — fine.
      }
      // Switch the audio session into record mode. Without this iOS
      // routes through the playback category (silenced when the ringer
      // switch is off) and Android's voice routing can be wrong on
      // some OEMs. No-op on web.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setDidStart(true);
      setRecordedUri(null);
      setMeteringHistory([]);
      cutoffTimerRef.current = setTimeout(() => {
        // Hard 60 s cap — fire-and-forget; the recorder.stop()
        // promise resolves async and the state listener will pick
        // up isRecording=false on the next poll.
        recorder
          .stop()
          .then(() => setRecordedUri(recorder.uri ?? null))
          .catch(() => {
            // Already stopped — fine.
          });
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      console.warn('[VoiceRecordingSheet] start failed', err);
      Alert.alert(
        'Recording failed',
        err instanceof Error ? err.message : 'Could not start the microphone.',
      );
    }
  }, [ensurePermission, isRecording, recorder, requesting, sending, player]);

  const handleStop = useCallback(async () => {
    if (cutoffTimerRef.current) {
      clearTimeout(cutoffTimerRef.current);
      cutoffTimerRef.current = null;
    }
    try {
      await recorder.stop();
      setRecordedUri(recorder.uri ?? null);
    } catch (err) {
      console.warn('[VoiceRecordingSheet] stop failed', err);
    }
  }, [recorder]);

  const handleToggle = useCallback(() => {
    if (isRecording) {
      handleStop();
    } else {
      handleStart();
    }
  }, [isRecording, handleStart, handleStop]);

  // Play / pause the recorded clip for review before sending.
  const handlePlayToggle = useCallback(async () => {
    if (!recordedUri) return;
    try {
      // Route to the speaker for playback (recording mode silences
      // output on iOS). playsInSilentMode so it's audible with the
      // ringer switch off.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (isPlaying) {
        player.pause();
      } else {
        // Restart from the top if we're at (or past) the end.
        if (playbackDuration > 0 && playbackCurrent >= playbackDuration - 0.05) {
          player.seekTo(0);
        }
        player.play();
      }
    } catch (err) {
      console.warn('[VoiceRecordingSheet] playback failed', err);
    }
  }, [recordedUri, isPlaying, player, playbackCurrent, playbackDuration]);

  const handleCancel = useCallback(async () => {
    if (cutoffTimerRef.current) {
      clearTimeout(cutoffTimerRef.current);
      cutoffTimerRef.current = null;
    }
    try {
      player.pause();
    } catch {
      // No active playback — fine.
    }
    try {
      await recorder.stop();
    } catch {
      // Recorder may already be stopped — discard.
    }
    setRecordedUri(null);
    setMeteringHistory([]);
    setDidStart(false);
    onClose();
  }, [onClose, recorder, player]);

  const handleSend = useCallback(async () => {
    if (!recordedUri || sending || sendInFlightRef.current) return;
    // Flip the synchronous guard BEFORE any await so a second tap that
    // arrives in the same JS turn (before `sending` has had a chance
    // to flip via the parent's setState) returns at the guard above.
    sendInFlightRef.current = true;
    try {
      player.pause();
    } catch {
      // No active playback — fine.
    }
    try {
      // Belt-and-braces size cap. The 60 s recording limit *should*
      // keep an AAC clip well under 2 MB at typical speech bitrates,
      // so this path is unlikely to trigger today — but if a user
      // swaps to a stricter Blossom server, or the codec/quality
      // changes in future, we'd rather fail fast here than burn
      // upload bandwidth on a clip the server will reject anyway.
      try {
        const sizeBytes = await getFileSizeBytes(recordedUri);
        if (sizeBytes > MAX_VOICE_NOTE_SIZE_BYTES) {
          const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
          Alert.alert(
            'Voice note too large',
            `Voice note too large (${sizeMb} MB). Maximum is 5 MB. Try recording a shorter clip.`,
          );
          // Failed fast — let the user retry; clear the guard so a
          // subsequent tap can proceed.
          sendInFlightRef.current = false;
          return;
        }
      } catch (err) {
        console.warn('[VoiceRecordingSheet] size check failed', err);
        // Fall through — let the upload path surface its own error
        // rather than blocking the send because we couldn't stat the
        // file.
      }
      await onSend(recordedUri);
    } catch (err) {
      // Parent's onSend may throw — clear the guard so the user can
      // retry without remounting the sheet.
      sendInFlightRef.current = false;
      throw err;
    }
    // Note: on success we leave sendInFlightRef = true. The sheet is
    // about to be dismissed by the parent, and `visible` flipping will
    // reset the ref on the next open. Holding it true in the meantime
    // prevents a third tap from racing in if the user happens to keep
    // jabbing the button while the sheet is animating away.
  }, [recordedUri, sending, onSend, player]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior="none"
      />
    ),
    [],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const elapsedLabel = fmtTime(elapsedSeconds);

  const hint = isRecording
    ? `Recording... tap stop when you're done (max ${MAX_RECORDING_SECONDS}s)`
    : isFinalised
      ? 'Tap play to listen back, then Send'
      : didStart
        ? 'Tap the mic to record again'
        : 'Tap the mic to start recording';

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      // Stack on top of the parent attach panel so the close cascade
      // doesn't dismiss the underlying ConversationScreen — same
      // pattern GifPickerSheet uses.
      stackBehavior="push"
    >
      <BottomSheetView style={styles.content} testID="voice-recording-sheet">
        <Text style={styles.title}>Voice note</Text>
        <Text style={styles.encryptionNote} testID="voice-encryption-note">
          End-to-end encrypted (AES-256-GCM): the audio is encrypted on your device before upload,
          so only you and the recipient can play it.
        </Text>

        {!isFinalised && (
          <Text style={styles.elapsed} testID="voice-elapsed">
            {elapsedLabel}
          </Text>
        )}

        <View style={styles.micArea}>
          {isRecording ? (
            <Animated.View
              style={[styles.pulse, { backgroundColor: colors.brandPink }, pulseStyle]}
            />
          ) : null}
          <TouchableOpacity
            style={[styles.micButton, { backgroundColor: colors.brandPink }]}
            onPress={handleToggle}
            disabled={sending || requesting}
            accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            accessibilityState={{ disabled: sending || requesting }}
            testID="voice-record-toggle"
          >
            {isRecording ? (
              <Square size={36} color={colors.white} fill={colors.white} />
            ) : (
              <Mic size={36} color={colors.white} />
            )}
          </TouchableOpacity>
        </View>

        {/* Live waveform while recording */}
        {isRecording && meteringHistory.length > 0 && (
          <View style={styles.liveWave}>
            <Waveform data={meteringHistory} progress={1} colors={colors} />
          </View>
        )}

        {/* WhatsApp-style review row: play/pause + waveform + time */}
        {isFinalised && (
          <View style={styles.playerCard} testID="voice-player-card">
            <TouchableOpacity
              style={styles.playButton}
              onPress={handlePlayToggle}
              accessibilityLabel={isPlaying ? 'Pause playback' : 'Play voice note'}
              testID="voice-play-toggle"
            >
              {isPlaying ? (
                <Pause size={20} color={colors.white} fill={colors.white} />
              ) : (
                <Play size={20} color={colors.white} fill={colors.white} />
              )}
            </TouchableOpacity>
            <Waveform data={meteringHistory} progress={playbackProgress} colors={colors} />
            <Text style={styles.playerTime} testID="voice-player-time">
              {reviewTimeLabel}
            </Text>
          </View>
        )}

        <Text style={styles.hint}>{hint}</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.cancelButton, sending && styles.sendButtonDisabled]}
            onPress={handleCancel}
            disabled={sending}
            accessibilityLabel="Cancel voice note"
            accessibilityState={{ disabled: sending }}
            testID="voice-cancel-button"
          >
            <X size={18} color={colors.textBody} />
            <Text style={[styles.actionLabel, { color: colors.textBody }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.sendButton,
              (!isFinalised || sending) && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!isFinalised || sending}
            accessibilityLabel="Send voice note"
            accessibilityState={{ disabled: !isFinalised || sending }}
            testID="voice-send-button"
          >
            <Send size={18} color={colors.white} />
            <Text style={[styles.actionLabel, { color: colors.white }]}>
              {sending ? 'Sending...' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

/**
 * Stat a local `file://` URI via expo-file-system (native, reliable on
 * Android). The previous XHR-to-Blob approach failed on the recorder's
 * cache path ("Failed to stat file://…/cache/Audio/…m4a") — RN's XHR on
 * file:// is flaky — so we read the size natively (matches AboutScreen).
 */
async function getFileSizeBytes(fileUri: string): Promise<number> {
  const info = await getInfoAsync(fileUri);
  if (!info.exists) throw new Error(`File not found: ${fileUri}`);
  return info.size;
}

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 28,
      alignItems: 'center',
      gap: 14,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    encryptionNote: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingHorizontal: 4,
      lineHeight: 16,
    },
    elapsed: {
      fontSize: 32,
      fontWeight: '700',
      color: colors.textBody,
      // Tabular nums so the seconds digit doesn't shift the layout
      // every time it ticks up.
      fontVariant: ['tabular-nums'],
    },
    micArea: {
      width: 120,
      height: 120,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 4,
    },
    pulse: {
      position: 'absolute',
      width: 120,
      height: 120,
      borderRadius: 60,
    },
    micButton: {
      width: 84,
      height: 84,
      borderRadius: 42,
      alignItems: 'center',
      justifyContent: 'center',
      // Crisp shadow so the mic feels tappable even when the pulse is
      // dim (start-of-utterance, breath pauses).
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    liveWave: {
      alignSelf: 'stretch',
      height: 34,
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    playerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      gap: 12,
      backgroundColor: colors.background,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    playButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playerTime: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontVariant: ['tabular-nums'],
      minWidth: 40,
      textAlign: 'right',
    },
    hint: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    buttonRow: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      gap: 12,
      marginTop: 8,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: colors.background,
    },
    sendButton: {
      backgroundColor: colors.brandPink,
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
    actionLabel: {
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default VoiceRecordingSheet;
