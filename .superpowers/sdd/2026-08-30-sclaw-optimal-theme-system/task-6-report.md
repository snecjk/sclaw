# Task 6 Report: Unified Navigation and Collection Cards

## Outcome

Task 6 is implemented. App, Skill, Connector, Workflow, and Task collection cards now consume the shared Card color/state recipe while retaining their family-specific geometry. Sidebar and picker rows consume the shared Navigation recipe. A typed native-button overlay supplies one keyboard-safe primary action without wrapping content or nesting secondary controls.

## RED / GREEN

- RED — `collection-card-action.test.tsx` failed at import resolution because `CollectionCardAction` did not exist.
- GREEN — the new focused component test passed 4/4 after adding the typed native button, including focus participation, one activation for the browser Enter/Space click sequence, and sibling secondary-action isolation.
- RED — the Card/sidebar recipe assertions failed in three places before the overlay and Navigation states existed.
- GREEN — the recipe/surface assertions passed after adding shared hover, selected, and focus-visible states plus overlay stacking.
- RED — the ruled-in Workflow list-card test could not find the accessible `打开结算对账流程` action.
- GREEN — Workflow list-card passed 3/3 after its shell received the shared sibling overlay; its install button remained isolated.
- GREEN — the final interaction/surface/card/source/contract run passed 12 files and 248 tests.

## Per-family migration

| Family | Migration | Preserved behavior and geometry |
| --- | --- | --- |
| App | `AppCard` and App Market rows use `collectionCardShellClass` plus `CollectionCardAction`. | Existing card/row geometry, icons, copy, favorite/edit/delete actions, external-app behavior, and open behavior. |
| Skill | `SkillCard` uses the shared overlay when detail opening is available. | Existing radius, border, layout, install/use/delete controls, status, media, and metadata. |
| Connector | Removed the hand-authored article role/tab/key emulation and added the native overlay button. | Existing 80px geometry, icon/status content, connect/disconnect/token controls, busy state, and connected/disconnected routing. The primary action is disabled only for the existing in-flight disconnected state. |
| Workflow | `workflow-list-card.tsx` now uses the shared overlay on both mine and official shells. | Cover, copy, metadata, highlighted geometry, enabled/dimmed status, edit/more/install controls, and callbacks. |
| Task | `myTaskCardShellClass` now composes the shared Card recipe and `TaskCard` has an optional whole-card overlay. | Original 18px radius, 0.8px border, sizing, content, switch, run, menu, running state, and callbacks. |

The approved task file list omitted `src/pages/Workflow/components/workflow-list-card.tsx`, but this is the actual clickable Workflow collection shell. The parent ruling explicitly added it and its focused test to scope. The implementation and verification therefore include `src/pages/Workflow/components/workflow-list-card.tsx` and `tests/unit/workflow-list-card.test.tsx`.

## Keyboard and stacking evidence

- `CollectionCardAction` is a typed `ButtonHTMLAttributes<HTMLButtonElement>` native button with default `type="button"`; it is focusable without synthetic roles or key handlers.
- The overlay is an absolute, inset sibling at z-index 1. Card content is never wrapped by the button.
- Secondary buttons, links, inputs, selects, textareas, and explicit button roles are raised to z-index 2, so they remain independently clickable and focusable and cannot invoke the primary card action.
- The shared shell receives hover and `:focus-visible` treatment through color/box-shadow only; no border-width, radius, padding, or size changes occur, so there is no layout shift.
- Tests assert that the secondary button shares the card parent with the overlay, is not contained by it, fires once itself, and never fires the card callback.
- Existing disabled/loading/status semantics remain native. No new product state is encoded in Radix `data-state`; recipe-only synthetic states remain under `data-sto-state`.

## Sidebar and Navigation

- Main links, scheduled-task rows, recent sessions, project sessions, project headers, picker rows, and header actions consume `sto-navigation-item` states.
- Selection is represented with `aria-current`; focus-visible and descendant focus share the Navigation focus shadow.
- Skill Plaza categories use a filter modifier that retains the approved transparent/default and light selected pixels while sharing semantic hover/focus/selected colors.
- Dark hierarchy remains token-owned at canvas `#0D0D0D`, sidebar `#212121`, and selected/elevated `#282828`. The unchanged Electron baselines confirm approved light output is pixel-identical.

## Audit movement

- `pageDarkUtility`: 1121 → 1116 (−5)
- `pageDarkSelector`: 143 → 143 (unchanged)
- `coolDarkShadow`: 69 → 69 (unchanged)
- `rawColor`: 2190 → 2181 (−9)
- The source-audit snapshot changes contain only reviewed debt removals or context relocation caused by adjacent semantic markup.
- The theme-system contract allowlist shrank by removing `sidebar-header-toggle.tsx` and `sidebar-projects-section.tsx`; no new allowlist debt was added.

## Verification

- Focused interaction/surface/card/source/contract tests: **248 passed in 12 files**.
- Focused ESLint over every changed TypeScript/TSX source and test: **passed**.
- `git diff --check`: **passed**.
- Electron visual compare, without `--update`: **light matched 1440×1000; dark matched 1440×1000**. The first sandboxed GUI launch aborted with `SIGABRT`; the authorized unsandboxed rerun matched both unchanged baselines.
- Local `tsc --noEmit`: reached TypeScript and reported only existing errors in unrelated files (`AiBeautifyIcon`, `TutorialViewer`, `SclawBrowserFrame`, DingTalk/quote/voice helpers, Channels, ChatInput, and `TaskInstructionComposer`); no Task 6 file appears in diagnostics. The `pnpm` wrapper itself could not verify/download its pinned executable under restricted registry access, so verification used the already-installed local compiler.
- Documentation review: this internal visual/interaction consolidation changes no public flow, interface, or architecture requiring README edits. Only `README.md` exists at the expected repository root; `README.zh-CN.md` and `README.ja-JP.md` are absent.

## Production line delta

Production sources: **+181 / −83, net +98 lines**. This includes the 16-line typed overlay component and consolidation of duplicate card/navigation state classes. Tests, snapshots, and this report are excluded.

## Self-review and concerns

- Confirmed all five collection families use a sibling overlay and retain family-owned geometry.
- Confirmed secondary controls are above the overlay and remain native interactive elements.
- Confirmed no dependency, install, lockfile, build/config/script, or unrelated source change is included.
- Confirmed no memo wrapper was introduced; existing wrappers/hooks were left untouched.
- Confirmed Electron baselines were not updated.
- Concern: repository-wide typecheck remains non-green due to the unrelated pre-existing diagnostics listed above. Task 6 focused tests, lint, source contracts, and pixel comparisons are green.
