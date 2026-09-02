# Task 9 report — Adaptive/Fidelity preview intent and native propagation

## Stages

1. Added preview intent contracts and missing System-light/System-dark native propagation coverage.
2. RED: the Word mammoth fallback test expected Fidelity and received Adaptive.
3. GREEN: changed the fallback iframe to Fidelity; preview/native suites pass.
4. Ran the required Electron screenshot runner once and updated the approved matrix with its evidence status.

## RED / GREEN evidence

- RED: `NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/preview-srcdoc.test.ts`
  - Failed as intended: `keeps the Word HTML fallback in fidelity mode` received `data-sto-preview-mode="adaptive"` rather than `fidelity`.
- GREEN: `NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/preview-srcdoc.test.ts`
  - 12 tests passed.
- Native appearance: `NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/native-appearance.test.ts tests/unit/theme-controller.test.tsx tests/unit/host-events.test.ts`
  - 32 tests passed across 3 files.
- Changed-file lint: `../../node_modules/.bin/eslint src/components/file-preview/WordDocViewer.tsx tests/unit/preview-srcdoc.test.ts tests/unit/native-appearance.test.ts`
  - Passed.
- Diff whitespace: `git diff --check`
  - Passed.

## Changed files

- `src/components/file-preview/WordDocViewer.tsx` — mammoth Word fallback now retains Fidelity paper rendering.
- `tests/unit/preview-srcdoc.test.ts` — Adaptive token, Fidelity non-recoloring, and Word fallback regression coverage.
- `tests/unit/native-appearance.test.ts` — explicit System-to-Light and System-to-Dark propagation coverage for main/sprite/float windows.
- `tests/visual/approved-page-matrix.md` — recorded automated Light/Dark/System evidence and remaining real-page observation status.

Electron appearance runtime files were untouched; the focused native tests already passed through the existing propagation path.

## Production delta

- Task production delta: `+1/-1`, net `0`.
- Cumulative production delta from `theme-approved-baseline-20260830`: `+2106/-1980`, net `+126`.

## Concern

The required one-shot Electron screenshot command, `../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs`, exited with `SIGABRT` before producing screenshots. No rerun was made. Real-page visual observation remains recorded as pending.
