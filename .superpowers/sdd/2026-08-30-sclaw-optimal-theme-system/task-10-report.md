# Task 10 final cleanup report

## Source cleanup

- `tokens.css`: removed 79 lines of dead or duplicate declarations. The reviewed zero-consumer set includes 28 primitive/feature aliases (`accent-soft`, `border-strong`, unused primitive HSL aliases, `elevated`, info/warning aliases, unused workflow cover triplets, and workflow hero input border/ring). It also removes one-hop card, control, segment, navigation, overlay, feedback, composer, Markdown, and flat-card aliases after their recipes were pointed at the existing canonical values.
- `recipes.css`: consolidated the four glass recipes, removed card-local disabled-source declarations that were never read, reused canonical semantic values, and kept the interaction colors in the recipe owner. Result: 36 added / 49 deleted.
- `globals.css`: removed five zero-consumer layout variables and the duplicate dark layout mapping while preserving the dark header-height override required by the existing shell contract. Markdown quote/divider colors now reuse identical canonical semantic values. Result: 2 added / 38 deleted.
- Exact Task 10 production delta: **38 added / 166 deleted / net -128**.
- Exact cumulative production delta from `theme-approved-baseline-20260830`: **2034 added / 2036 deleted / net -2**.

An exact source search for every removed alias returned no production consumer. A full token scan left three apparent source-zero aliases only: `--sto-card-inset-bg`, `--sto-grey-10`, and `--sto-wf-hero-input-bg`; each is retained because a focused appearance/contract test directly specifies its approved mapping.

## RED and GREEN evidence

- RED: the new dead-alias contract in `theme-source-audit.test.ts` failed with all 28 reviewed aliases still present.
- GREEN: the lean required batch reached 336/337 assertions; its only failure was a stale ownership assertion looking for the raised-dialog shadow in `more-apps.css` even though `recipes.css` was already the canonical owner in `HEAD`.
- Ownership-contract repair: changed only that assertion to inspect `recipesCss`, preserving the exact expected shadow value. Focused rerun: `dark-appearance-tokens.test.ts` **24/24 passed**.
- The other required/focused checks in the lean batch passed: source audit, system contract, approved baseline, light tokens, dark surface guard, computed styles, preview source document, card recipes, and control recipes. The two audit snapshots were updated only for the reviewed shrink/ownership changes.
- ESLint on the three changed TypeScript test files: passed with zero warnings.
- `git diff --check theme-approved-baseline-20260830`: passed.

## Screenshot and manual matrix

- The single authorized Electron screenshot-runner attempt exited with `SIGABRT` before capture. It was not repeated.
- No real page was manually observed in Light, Dark, or System. The matrix therefore remains honestly at **0 checked / 30 unchecked** cells; no evidence was fabricated.
- The approved-baseline, light-token, and computed-style tests passed, but there is no new Task 10 screenshot evidence from which to claim a manual pixel comparison.

## Ownership rules and audits

- `.cursor/rules/02-styles.mdc` now states that `tokens.css` is the sole Light/Dark/System mapping owner, `recipes.css` is the sole shared interaction-color owner, and `globals.css` is limited to reset/layout/size/type/animation. It also enforces layout-only pages, sibling `CollectionCardAction`, the complete interaction state chain, and Adaptive/Fidelity ownership.
- Preview audit: zero duplicate core palette declarations; exactly one `tokens.css?raw` import.
- Task 10 added-line audit: zero new color-bearing `dark:` utilities, leading `.dark` selectors, or targeted cool raw palettes.
- Retained repository migration ledger: **838** color-bearing `dark:` utilities across **72** files; **19** leading `.dark` selectors across **3** files (18 outside `tokens.css`, across `LearningCenterPage.css` and `globals.css`); and **41** targeted cool raw palette occurrences across **17** files. These are remaining migration debt, not a zero-source claim, and the existing source-audit snapshot continues to prevent growth.
- Forbidden-path diff for manifest, package metadata/lockfile, Vite/Vitest/Electron configuration, and workflows: empty.

## Staged scope and concerns

Staged paths are limited to the three production stylesheets, the style rule, the two audit/contract tests and snapshots, the authorized dark-token assertion repair, the evidence matrix, and this report.

Concerns remaining for the controller: the Electron runner abort prevented screenshot evidence; all 30 manual matrix cells remain open; and the exact migration-debt counts above remain intentionally preserved for later scoped work. No broad suite, full typecheck, build, package, or repeated screenshot run was performed under the lean override.
