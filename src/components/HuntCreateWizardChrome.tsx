import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Check, ChevronLeft, Lock } from 'lucide-react-native';
import type { Palette } from '../styles/palettes';
import type { HuntCreateScreenStyles } from '../styles/HuntCreateScreen.styles';

// Presentational chrome for the Hide-a-Piglet wizard (HuntCreateScreen):
// the numbered step header, the top progress stepper, the back/next nav
// row, the difficulty/terrain level picker, the size/type option picker,
// and the supported-NFC-tags card. All pure — they take styles + colours
// and render; no state, no side effects. Lifted out of the screen so the
// screen stays composition (CLAUDE.md → File size and modularity).

// Numbered step header. `status` drives the badge tint — active vs done —
// so completed steps fade back once the user moves on (e.g. Step 2 marks
// done once LNURL validation lands).
export const StepHeader: React.FC<{
  n: number;
  title: string;
  subtitle: string;
  status: 'active' | 'done';
  colors: Palette;
  styles: HuntCreateScreenStyles;
}> = ({ n, title, subtitle, status, colors, styles }) => (
  <View style={styles.stepHeader} accessibilityRole="header">
    <View style={[styles.stepBadge, status === 'done' && styles.stepBadgeDone]}>
      {status === 'done' ? (
        <Check size={14} color={colors.white} strokeWidth={2.8} />
      ) : (
        <Text style={styles.stepBadgeText}>{n}</Text>
      )}
    </View>
    <View style={styles.stepHeaderText}>
      <Text style={styles.stepHeaderTitle}>{title}</Text>
      <Text style={styles.stepHeaderSubtitle}>{subtitle}</Text>
    </View>
  </View>
);

// Top-of-screen horizontal stepper — numbered pips + short labels. Two
// states only: pink once reached (current step or behind), grey ahead.
// The current pip is scaled up so you can see where you are.
const STEP_LABELS: { n: number; label: string }[] = [
  { n: 1, label: 'Hardware' },
  { n: 2, label: 'Prize' },
  { n: 3, label: 'Location' },
  { n: 4, label: 'Details' },
  { n: 5, label: 'Publish' },
  { n: 6, label: 'Write NFC' },
];

export const StepProgressBar: React.FC<{
  currentStep: 1 | 2 | 3 | 4 | 5 | 6;
  onPipPress: (n: 1 | 2 | 3 | 4 | 5 | 6) => void;
  styles: HuntCreateScreenStyles;
}> = ({ currentStep, onPipPress, styles }) => {
  return (
    <View style={styles.stepperRow} accessibilityRole="progressbar">
      {STEP_LABELS.map(({ n, label }, idx) => {
        const stepN = n as 1 | 2 | 3 | 4 | 5 | 6;
        const reached = stepN <= currentStep;
        const isCurrent = currentStep === stepN;
        return (
          <React.Fragment key={n}>
            <TouchableOpacity
              style={styles.stepperPipWrap}
              onPress={() => onPipPress(stepN)}
              testID={`hunt-piggy-step-pip-${n}`}
              accessibilityLabel={`Step ${n} of 6: ${label}`}
            >
              <View
                style={[
                  styles.stepperPip,
                  reached ? styles.stepperPipActive : styles.stepperPipPending,
                  isCurrent && styles.stepperPipCurrent,
                ]}
              >
                <Text style={[styles.stepperPipText, !reached && styles.stepperPipTextPending]}>
                  {n}
                </Text>
              </View>
              <Text
                style={[
                  styles.stepperLabel,
                  !reached && styles.stepperLabelPending,
                  isCurrent && styles.stepperLabelCurrent,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
            {idx < STEP_LABELS.length - 1 ? (
              <View
                style={[
                  styles.stepperConnector,
                  stepN < currentStep
                    ? styles.stepperConnectorReached
                    : styles.stepperConnectorPending,
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
};

// Back / Next row under each wizard step's content. Step 1 has no Back;
// step 5 swaps Next for the Publish CTA so the row is usually rendered
// without `onNext` on the final page.
export const StepNavRow: React.FC<{
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  // Optional leading icon for the next button — the final step uses it
  // for the Publish / Save / Done action so it isn't text-only.
  nextIcon?: typeof Check;
  styles: HuntCreateScreenStyles;
  colors: Palette;
}> = ({ onBack, onNext, nextLabel = 'Next', nextDisabled, nextIcon: NextIcon, styles, colors }) => (
  <View style={styles.stepNavRow}>
    {onBack ? (
      <TouchableOpacity
        style={styles.stepNavBackButton}
        onPress={onBack}
        testID="hunt-piggy-step-back"
        accessibilityLabel="Back to previous step"
      >
        <ChevronLeft size={16} color={colors.textHeader} strokeWidth={2.5} />
        <Text style={styles.stepNavBackText}>Back</Text>
      </TouchableOpacity>
    ) : null}
    {onNext ? (
      <TouchableOpacity
        style={[styles.stepNavNextButton, nextDisabled && styles.stepNavNextButtonDisabled]}
        onPress={onNext}
        disabled={nextDisabled}
        testID="hunt-piggy-step-next"
        accessibilityLabel={nextLabel}
      >
        {NextIcon ? <NextIcon size={16} color={colors.white} strokeWidth={2.5} /> : null}
        <Text style={styles.stepNavNextText}>{NextIcon ? nextLabel : `${nextLabel} ›`}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

// 1-5 level picker for difficulty / terrain — coloured rectangles that
// fill up to the chosen value (mirrors the cache-detail SegmentBar), kept
// visually distinct from the numbered step pips at the top.
export const LevelPicker: React.FC<{
  value: number;
  onChange: (v: number) => void;
  styles: HuntCreateScreenStyles;
}> = ({ value, onChange, styles }) => (
  <View style={styles.levelPickerRow}>
    {[1, 2, 3, 4, 5].map((n) => (
      <TouchableOpacity
        key={n}
        style={[styles.levelSegment, n <= value && styles.levelSegmentFilled]}
        onPress={() => onChange(n)}
        testID={`hunt-piggy-level-${n}`}
        accessibilityLabel={`Level ${n}`}
        accessibilityState={{ selected: n === value }}
      />
    ))}
  </View>
);

// Single-select pill row for the geocache-info step (size, type). Values
// are strings — callers cast at the edge.
export const OptionPicker: React.FC<{
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
  styles: HuntCreateScreenStyles;
}> = ({ value, options, onChange, styles }) => (
  <View style={styles.optionPickerRow}>
    {options.map((o) => {
      const active = o.v === value;
      return (
        <TouchableOpacity
          key={o.v}
          style={[styles.optionPill, active && styles.optionPillActive]}
          onPress={() => onChange(o.v)}
          testID={`hunt-piggy-option-${o.v}`}
          accessibilityState={{ selected: active }}
        >
          <Text style={[styles.optionPillText, active && styles.optionPillTextActive]}>
            {o.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

export const NfcSupportedTagsCard: React.FC<{
  colors: Palette;
  styles: HuntCreateScreenStyles;
}> = ({ colors, styles }) => (
  <View style={styles.tagsCard} testID="hunt-create-supported-tags">
    <View style={styles.tagsCardHeader}>
      <Lock size={14} color={colors.brandPink} strokeWidth={2.5} />
      <Text style={styles.tagsCardHeaderText}>Supported NFC tags</Text>
    </View>
    {/* Tightened two-row form so the "Write to NFC tag" + Next buttons
        fit on a Pixel without scrolling. Long-form rationale lives in
        docs/, not in the wizard. */}
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCheck}>✓</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>NTAG215 / 216</Text> — fit the multi-record payload + the
        reversible PWD/PACK lock.
      </Text>
    </View>
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCross}>✗</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>NTAG213</Text> — only 144 bytes of user memory, too small
        for the Hide-a-Piglet payload.
      </Text>
    </View>
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCross}>✗</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>Ultralight C / Mifare Classic</Text> — too small or can't
        lock.
      </Text>
    </View>
    <View style={styles.tagsCardParagraph}>
      <Text style={styles.tagsCardCross}>✗</Text>
      <Text style={styles.tagsCardParagraphText}>
        <Text style={styles.tagsCardName}>NTAG424</Text> — not supported yet (needs AES auth, GH
        #558).
      </Text>
    </View>
  </View>
);
