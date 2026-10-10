import React, { forwardRef } from 'react';
// This wrapper is the one sanctioned consumer of the raw modal — every
// other file is steered here by `no-restricted-imports` in eslint.config.js.
/* eslint-disable no-restricted-imports */
import {
  BottomSheetModal as GorhomBottomSheetModal,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
/* eslint-enable no-restricted-imports */

/**
 * Accessibility props forced onto every sheet's content container.
 *
 * @gorhom/bottom-sheet v5 defaults the content container to
 * `accessible={true}` + label "Bottom Sheet" + role "adjustable". On iOS an
 * accessible view swallows its whole subtree into ONE accessibility element,
 * so VoiceOver can't reach any control inside a sheet and Maestro's iOS
 * hierarchy shows only "Bottom Sheet" (no testIDs, no text).
 *
 * `accessible: false` lets each child be its own element again. The label /
 * role are nulled too (the library maps `null` → "not set") so the plain
 * container doesn't keep advertising a bogus "adjustable" control —
 * TalkBack included. The sheet still announces itself via the library's
 * background ("Bottom Sheet"), handle ("Bottom sheet handle") and backdrop
 * ("Bottom sheet backdrop", "Tap to close…"), which are untouched.
 */
export const SHEET_CONTENT_A11Y_PROPS = {
  accessible: false,
  accessibilityLabel: null,
  accessibilityRole: null,
} as const satisfies Pick<
  BottomSheetModalProps,
  'accessible' | 'accessibilityLabel' | 'accessibilityRole'
>;

type ForcedA11yProp = keyof typeof SHEET_CONTENT_A11Y_PROPS;

export type AccessibleBottomSheetModalProps = Omit<BottomSheetModalProps, ForcedA11yProp>;

/** Ref type — same imperative API (`present`, `dismiss`, …) as the library's. */
export type BottomSheetModal = GorhomBottomSheetModal;

/**
 * Drop-in replacement for `@gorhom/bottom-sheet`'s `BottomSheetModal` that
 * keeps sheet content reachable by VoiceOver / TalkBack / Maestro. Use this
 * for every sheet (ESLint enforces it). The a11y props are applied last and
 * omitted from the prop type so a call site can't accidentally re-collapse
 * the sheet.
 */
export const BottomSheetModal = forwardRef<GorhomBottomSheetModal, AccessibleBottomSheetModalProps>(
  function AccessibleBottomSheetModal(props, ref) {
    return <GorhomBottomSheetModal {...props} {...SHEET_CONTENT_A11Y_PROPS} ref={ref} />;
  },
);
