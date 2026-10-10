// Maestro `runScript` helper: a per-run tag so assertions can never pass on
// bubbles left over from an earlier run. Uses RUN_TAG when the runner passes
// one (scripts/signer-matrix-e2e.sh), else makes one up.
output.tag =
  typeof RUN_TAG !== 'undefined' && RUN_TAG ? RUN_TAG : 'sm' + new Date().getTime().toString(36);
