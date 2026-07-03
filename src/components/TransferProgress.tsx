import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Check, Circle, X as XIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createTransferProgressStyles } from '../styles/TransferProgress.styles';
import type { TransferProgress as TransferProgressState } from '../utils/transferPhase';

interface Props {
  /** Amount being transferred, in sats. */
  amountSats: number;
  /** Source wallet alias (top of the "route" line). */
  sourceAlias?: string;
  /** Destination wallet alias (bottom of the "route" line). */
  destAlias?: string;
  /** Pre-formatted fee/eta string ("~X sats · ~10-60 min"), or null. */
  feeEstimate: string | null;
  /** Step-model state driving the ✓ / spinner / ○ checklist. */
  progress: TransferProgressState;
  /** Legacy per-step sublabel shown under the checklist. */
  progressMsg: string | null;
  /**
   * Non-null once the background swap task errored — suppresses the
   * active-step spinner and surfaces the "Retry now" button.
   */
  backgroundError: string | null;
  /** True once a recovery retry has been acknowledged (hides Retry). */
  recoveryAcked: boolean;
  /** True while a recovery retry is in flight (disables + spins Retry). */
  retryingRecovery: boolean;
  /** Fired when the user taps "Retry now". */
  onRetry: () => void;
  /** Fired when the user taps "Close". */
  onClose: () => void;
}

/**
 * Renders the Transfer sheet's in-flight step-by-step progress view
 * (issue #62) — the checklist that replaces the From/To/Amount form
 * while a transfer is executing. Purely presentational: it walks the
 * `progress` step model deciding whether each row shows a checkmark,
 * spinner, X, or empty circle, and exposes Retry / Close actions whose
 * orchestration lives in the parent TransferSheet.
 */
const TransferProgress: React.FC<Props> = ({
  amountSats,
  sourceAlias,
  destAlias,
  feeEstimate,
  progress,
  progressMsg,
  backgroundError,
  recoveryAcked,
  retryingRecovery,
  onRetry,
  onClose,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createTransferProgressStyles(colors), [colors]);

  return (
    <View style={styles.progressView}>
      <Text style={styles.progressSummary}>{amountSats.toLocaleString()} sats</Text>
      <Text style={styles.progressRoute}>
        {sourceAlias} → {destAlias}
      </Text>
      {feeEstimate && (
        <Text style={styles.feeText}>
          Fee: {feeEstimate.split('·')[0].trim()}
          {feeEstimate.includes('·') ? ` · ${feeEstimate.split('·')[1].trim()}` : ''}
        </Text>
      )}
      {/* Step-by-step status (issue #62). Walks the steps for the
          current transferType and renders ✓ / spinner / ○ per row.
          The legacy `progressMsg` becomes a sublabel under the
          active row so the rich Boltz "swap underway / safe to
          close" copy still surfaces. */}
      <View style={styles.stepList} testID="transfer-step-list">
        {progress.steps.map((s, idx) => {
          const isComplete = progress.phase === 'done' || idx < progress.activeIndex;
          const isFailed = progress.phase === 'failed' && idx === progress.activeIndex;
          const isActive =
            progress.phase === 'in-progress' &&
            idx === progress.activeIndex &&
            backgroundError === null;
          const status: 'complete' | 'failed' | 'active' | 'pending' = isComplete
            ? 'complete'
            : isFailed
              ? 'failed'
              : isActive
                ? 'active'
                : 'pending';
          return (
            <View
              key={s.id}
              style={styles.stepRow}
              testID={`transfer-step-${s.id}`}
              accessibilityLabel={`${s.label} ${status}`}
            >
              <View style={styles.stepIcon}>
                {status === 'complete' ? (
                  <Check size={20} color={colors.brandPink} />
                ) : status === 'failed' ? (
                  <XIcon size={20} color={colors.red} />
                ) : status === 'active' ? (
                  <ActivityIndicator size="small" color={colors.brandPink} />
                ) : (
                  <Circle size={20} color={colors.textSupplementary} />
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  status === 'pending' && styles.stepLabelPending,
                  status === 'failed' && styles.stepLabelFailed,
                ]}
              >
                {s.label}
              </Text>
            </View>
          );
        })}
      </View>
      {progressMsg && (
        <Text style={styles.progressText} testID="transfer-progress-msg">
          {progressMsg}
        </Text>
      )}
      {backgroundError !== null && !recoveryAcked && (
        <TouchableOpacity
          style={[styles.closeButton, retryingRecovery && styles.closeButtonDisabled]}
          onPress={onRetry}
          disabled={retryingRecovery}
          accessibilityLabel="Retry swap recovery"
          testID="transfer-retry-now"
        >
          {retryingRecovery ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.closeButtonText}>Retry now</Text>
          )}
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        accessibilityLabel="Close"
        testID="transfer-progress-close"
      >
        <Text style={styles.closeButtonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
};

export default TransferProgress;
