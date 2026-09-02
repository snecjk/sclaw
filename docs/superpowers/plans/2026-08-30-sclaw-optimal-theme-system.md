# SClaw Optimal Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the currently approved light appearance while consolidating light/dark/system theming into one semantic token and recipe system, completing neutral dark-mode coverage and removing page-level theme exceptions.

**Architecture:** Use four layers: raw palette values, semantic tokens, shared component recipes, and page layout/business state. `src/styles/theme/tokens.css` is the only theme mapping owner; `src/styles/theme/recipes.css` is the only shared interaction-state color owner. Pages consume semantic variables or shared recipes and do not contain their own dark palettes.

**Tech Stack:** React 19, TypeScript, Vite, Electron, CSS custom properties, Vitest, Testing Library, Electron `BrowserWindow.capturePage()`, Sharp.

**Spec:** `docs/superpowers/specs/2026-08-30-sclaw-optimal-theme-system-design.md`

## Global Constraints

- Preserve the approved light-mode pixels. Light-mode changes are limited to replacing equivalent literals with semantic variables.
- Preserve layout, dimensions, typography, radii, icon geometry, copy, data flow, and business behavior in both themes.
- Allowed dark visual corrections are neutralizing cool-tinted shadows/glows, normalizing equivalent states, restoring unreadable content, and unifying equivalent card shells.
- Do not add dependencies, run package installation commands, modify `package.json`, lockfiles, build configuration, scripts, CI, release files, or `resources/dws/manifest.json`.
- Do not introduce product-facing names or CSS identifiers containing `codex`.
- Do not add `useCallback`, `useMemo`, or `React.memo` unless an existing documented exception applies.
- Keep renderer/backend boundaries unchanged.
- Use `apply_patch` for hand edits. Preserve unrelated dirty-worktree changes.
- Build/package verification, if required, must run from `/Users/zzj/Desktop/workspace/sto/backend-project/sto-claw/`, never from a worktree snapshot.
- Every task starts with a failing test or audit where behavior is testable, makes the smallest implementation change, reruns focused verification, and commits only its listed files.
- The final active production CSS/TS/TSX line delta relative to tag `theme-approved-baseline-20260830` must be net zero or lower. Tests and documentation are excluded from this budget.

## File Responsibility Map

| Responsibility | Canonical owner |
|---|---|
| Light/dark/system value mapping | `src/styles/theme/tokens.css` |
| Shared card/control/navigation/overlay/feedback states | `src/styles/theme/recipes.css` |
| Global reset, typography, layout-only defaults | `src/styles/globals.css` |
| Reusable surface class names | `src/lib/surfaces.ts` |
| Adaptive preview theme injection | `src/lib/preview-srcdoc.ts` using `tokens.css?raw` |
| Reusable keyboard-safe collection card action | `src/components/ui/collection-card-action.tsx` |
| Source-policy enforcement | `tests/unit/theme-source-audit.test.ts` |
| Computed-style contract | `tests/unit/theme-computed-styles.test.tsx` |
| Pixel evidence | `tests/visual/theme-screenshot-runner.cjs` and `tests/visual/baselines/` |
| Manual real-page evidence | `tests/visual/approved-page-matrix.md` |

---

## Task 1: Create a Safe Theme-Only Checkpoint

**Files:**

- Modify only by staging: `src/**`, `.cursor/rules/02-styles.mdc`, and existing theme-related tests under `tests/unit/`
- Explicitly exclude: `resources/dws/manifest.json`, `.gitignore`, unrelated documents, and unrelated runtime changes

- [ ] Confirm the branch and inspect all dirty paths before staging:

```bash
git branch --show-current
git status --short
git diff -- resources/dws/manifest.json .gitignore
```

Expected branch: `canyang-ui-flow9-dark-appearance`. The manifest and `.gitignore` remain unstaged.

- [ ] Run the current approved theme regression set before checkpointing:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/app-shell-surface-tokens.test.ts \
  tests/unit/dark-appearance-surface-guard.test.ts \
  tests/unit/dark-appearance-tokens.test.ts \
  tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts \
  tests/unit/sto-neutral-controls.test.tsx \
  tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-control-recipes.test.ts \
  tests/unit/theme-dark-neutral-audit.test.ts \
  tests/unit/theme-system-contract.test.ts \
  tests/unit/test-run-drawer.test.tsx
```

- [ ] Stage theme paths explicitly, then inspect the staged file list:

```bash
git add src .cursor/rules/02-styles.mdc \
  tests/unit/app-shell-surface-tokens.test.ts \
  tests/unit/dark-appearance-surface-guard.test.ts \
  tests/unit/dark-appearance-tokens.test.ts \
  tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts \
  tests/unit/sto-neutral-controls.test.tsx \
  tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-control-recipes.test.ts \
  tests/unit/theme-dark-neutral-audit.test.ts \
  tests/unit/theme-system-contract.test.ts \
  tests/unit/test-run-drawer.test.tsx
git diff --cached --name-only
git diff --cached --check
```

- [ ] Prove excluded files are not staged:

```bash
git diff --cached --name-only | rg '^(resources/dws/manifest.json|.gitignore)$' && exit 1 || true
```

- [ ] Commit and create the exact comparison tag:

```bash
git commit -m "style: checkpoint approved theme baseline"
git tag theme-approved-baseline-20260830
git show --stat --oneline HEAD
```

- [ ] Before production edits, invoke `superpowers:using-git-worktrees` and create an isolated execution worktree from `theme-approved-baseline-20260830`. Confirm the new worktree is clean with `git status --short`.

## Task 2: Freeze Computed Styles and Pixel Baselines

**Files:**

- Create: `tests/fixtures/theme/approved-computed-styles.json`
- Create: `tests/unit/theme-approved-baseline.test.ts`
- Create: `tests/visual/theme-fixture.html`
- Create: `tests/visual/theme-screenshot-runner.cjs`
- Create: `tests/visual/baselines/theme-light.png`
- Create: `tests/visual/baselines/theme-dark.png`
- Create: `tests/visual/approved-page-matrix.md`

- [ ] Write a failing baseline-contract test that verifies all required roles exist for both themes:

```ts
import { describe, expect, it } from 'vitest'
import approved from '../fixtures/theme/approved-computed-styles.json'

const requiredRoles = [
  'canvas',
  'panel',
  'sidebar',
  'elevated',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'border',
  'borderStrong',
] as const

describe('approved theme baseline', () => {
  it.each(['light', 'dark'] as const)('defines every semantic role for %s', theme => {
    expect(Object.keys(approved[theme])).toEqual(expect.arrayContaining(requiredRoles))
  })
})
```

- [ ] Run the test and confirm it fails because the fixture does not exist:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/theme-approved-baseline.test.ts
```

- [ ] Add the approved values. Dark values must be exactly:

```json
{
  "canvas": "#0D0D0D",
  "panel": "#181818",
  "sidebar": "#212121",
  "elevated": "#282828",
  "textPrimary": "#DFDFDF",
  "textSecondary": "rgba(255, 255, 255, 0.70)",
  "textTertiary": "rgba(255, 255, 255, 0.50)",
  "border": "rgba(255, 255, 255, 0.08)",
  "borderStrong": "rgba(255, 255, 255, 0.16)"
}
```

Copy light values from the currently approved computed styles; do not infer new light colors.

- [ ] Build a static fixture containing Card, Control, Navigation, Segment, Overlay, and Feedback recipes in default, hover, active/selected, focus, disabled, loading, and error states. Use stable `data-testid` attributes and no timestamps, animations, remote assets, or system fonts that vary by machine.

- [ ] Implement a dependency-free runner using already-declared Electron and Sharp APIs:

```js
const { app, BrowserWindow } = require('electron')
const sharp = require('sharp')

async function capture(theme, outputPath) {
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    webPreferences: { backgroundThrottling: false },
  })
  await win.loadFile(require('path').join(__dirname, 'theme-fixture.html'), {
    query: { theme },
  })
  const image = await win.webContents.capturePage()
  await sharp(image.toPNG()).png().toFile(outputPath)
  win.destroy()
}
```

The full runner must support `--update` to write baselines and comparison mode that reads both PNGs through Sharp raw buffers and exits non-zero on any pixel difference.

- [ ] Generate and immediately verify the two baselines:

```bash
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs --update
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
```

- [ ] Create the real-page matrix with rows for Home/Chat, Sidebar, App Plaza, Skills/Connectors, Tasks/Workflow, Settings/Models/Agents, Dialog/Sheet/Tooltip/Toast, Markdown table, Adaptive preview, and Fidelity preview. Give each row Light, Dark, and System columns plus an Evidence column.

- [ ] Run the focused test and commit:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/theme-approved-baseline.test.ts
git add tests/fixtures/theme tests/unit/theme-approved-baseline.test.ts tests/visual
git commit -m "test: freeze approved theme appearance"
```

## Task 3: Add Repository-Wide Theme Source Auditing

**Files:**

- Create: `tests/unit/theme-source-audit.test.ts`
- Modify: `tests/unit/theme-system-contract.test.ts`
- Delete after parity: `tests/unit/theme-dark-neutral-audit.test.ts`

- [ ] Write a source audit that scans production `.css`, `.ts`, `.tsx`, and `.svg` files and reports file, line, and matched value for:

```ts
const forbiddenPatterns = {
  pageDarkUtility: /dark:(?:bg|text|border|shadow|ring)-/,
  pageDarkSelector: /^\s*\.dark\b/m,
  coolDarkShadow: /rgba\(\s*(?:2\s*,\s*8\s*,\s*23|15\s*,\s*23\s*,\s*42)/,
  rawColor: /#[\da-fA-F]{3,8}\b|(?:rgb|hsl)a?\(/,
}
```

Allow raw theme mappings only in `src/styles/theme/tokens.css`. Allow documented brand/status literals and Fidelity content only through an explicit, reviewed allowlist whose entries include a reason.

- [ ] Add contract assertions that:

  - `tokens.css` owns `:root`, `html[data-sto-theme='light']`, `.dark`, and `html[data-sto-theme='dark']` mappings.
  - `recipes.css` defines all shared state recipes.
  - ordinary page CSS has no `.dark` selector.
  - ordinary TSX has no color-bearing `dark:` utility.
  - preview code imports `tokens.css?raw` rather than maintaining a duplicate palette.

- [ ] Run the new audit and record the initial violations in test output. At this stage the strict audit is expected to fail; do not weaken patterns to make it green.

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/theme-source-audit.test.ts \
  tests/unit/theme-system-contract.test.ts
```

- [ ] Port every still-useful assertion from `theme-dark-neutral-audit.test.ts`, delete that weaker duplicate, and commit the red audit as the migration gate:

```bash
git add tests/unit/theme-source-audit.test.ts tests/unit/theme-system-contract.test.ts tests/unit/theme-dark-neutral-audit.test.ts
git commit -m "test: audit complete theme source coverage"
```

## Task 4: Consolidate Tokens and Remove the Preview Palette Copy

**Files:**

- Modify: `src/styles/theme/tokens.css`
- Modify: `src/styles/globals.css`
- Modify: `src/lib/preview-srcdoc.ts`
- Modify: `tests/unit/dark-appearance-tokens.test.ts`
- Modify: `tests/unit/light-appearance-tokens.test.ts`
- Modify: `tests/unit/preview-srcdoc.test.ts`
- Modify: `tests/unit/theme-system-contract.test.ts`

- [ ] Add failing tests proving the same token selectors serve renderer and adaptive preview:

```ts
expect(tokenCss).toContain(':root,')
expect(tokenCss).toContain("html[data-sto-theme='light']")
expect(tokenCss).toContain('.dark,')
expect(tokenCss).toContain("html[data-sto-theme='dark']")
expect(previewSource).toContain("tokens.css?raw")
expect(previewSource).not.toMatch(/--background:\s*#[\da-f]{3,8}/i)
```

- [ ] Run the focused tests and confirm the new assertions fail:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/dark-appearance-tokens.test.ts \
  tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts \
  tests/unit/theme-system-contract.test.ts
```

- [ ] Refactor selector ownership to this structure:

```css
:root,
html[data-sto-theme='light'] {
  color-scheme: light;
  /* approved light semantic mappings */
}

.dark,
html[data-sto-theme='dark'] {
  color-scheme: dark;
  --sto-canvas: #0d0d0d;
  --sto-panel: #181818;
  --sto-sidebar: #212121;
  --sto-elevated: #282828;
  --sto-text-primary: #dfdfdf;
  --sto-text-secondary: rgb(255 255 255 / 70%);
  --sto-text-tertiary: rgb(255 255 255 / 50%);
  --sto-border: rgb(255 255 255 / 8%);
  --sto-border-strong: rgb(255 255 255 / 16%);
}
```

Move remaining semantic color mappings from `globals.css` into `tokens.css`. Keep reset, type, spacing, and layout declarations in `globals.css`.

- [ ] Reuse the canonical CSS in preview code:

```ts
import themeTokensCss from '@/styles/theme/tokens.css?raw'

const adaptivePreviewRules = `
html[data-sto-preview-mode='adaptive'] body {
  color: var(--sto-text-primary);
  background: var(--sto-canvas);
}
`

function buildPreviewThemeStyle(mode: PreviewAppearanceMode): string {
  const modeRules = mode === 'adaptive' ? adaptivePreviewRules : ''
  return `<style data-sto-preview-theme>${themeTokensCss}\n${modeRules}</style>`
}
```

Adaptive rules must consume canonical semantic variables. They may add content-specific aliases, but not redefine the light or dark palette.

- [ ] Rerun focused tests and pixel baselines, inspect the light screenshot for zero visual change, then commit:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/dark-appearance-tokens.test.ts \
  tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts \
  tests/unit/theme-system-contract.test.ts
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
git add src/styles/theme/tokens.css src/styles/globals.css src/lib/preview-srcdoc.ts \
  tests/unit/dark-appearance-tokens.test.ts tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts tests/unit/theme-system-contract.test.ts
git commit -m "refactor: centralize theme token mappings"
```

## Task 5: Complete Shared Component Recipes and State Coverage

**Files:**

- Modify: `src/styles/theme/tokens.css`
- Modify: `src/styles/theme/recipes.css`
- Modify: `src/lib/surfaces.ts`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/textarea.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/tabs.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/dropdown-menu.tsx`
- Modify: `src/components/ui/tooltip.tsx`
- Create: `tests/unit/theme-computed-styles.test.tsx`
- Modify: `tests/unit/theme-card-recipes.test.ts`
- Modify: `tests/unit/theme-control-recipes.test.ts`
- Modify: `tests/unit/sto-neutral-controls.test.tsx`

- [ ] Write computed-style tests that mount each primitive under light and dark roots and assert every state uses semantic values. Include default, hover, active/selected, focus-visible, disabled, loading, and error.

```tsx
const states = ['default', 'hover', 'active', 'focus', 'disabled', 'loading', 'error'] as const

it.each(states)('maps control %s to a shared recipe', state => {
  render(<Button data-state={state}>Action</Button>)
  expect(screen.getByRole('button')).toHaveClass('sto-control')
  expect(screen.getByRole('button')).toHaveAttribute('data-state', state)
})
```

- [ ] Add test assertions that disabled controls retain readable text and borders and do not use whole-component opacity:

```ts
expect(recipeCss).not.toMatch(/\.sto-(?:control|card)[^{]*\[[^\]]*disabled[^\]]*\][^{]*\{[^}]*opacity\s*:/s)
expect(recipeCss).toContain('--sto-control-disabled-foreground')
expect(recipeCss).toContain('--sto-focus-ring')
```

- [ ] Run focused tests and confirm the missing state variables/recipes fail:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/theme-computed-styles.test.tsx \
  tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-control-recipes.test.ts \
  tests/unit/sto-neutral-controls.test.tsx
```

- [ ] Add semantic tokens for focus, disabled foreground/background/border, loading, success, warning, and error. Status colors may use the approved functional palette; ordinary surfaces and shadows remain neutral.

- [ ] Define the complete recipe families in `recipes.css`:

```css
.sto-card { /* default semantic surface and border */ }
.sto-card:hover { /* hover semantic surface and border */ }
.sto-card[data-selected='true'] { /* selected semantic surface */ }
.sto-card:has(:focus-visible) { /* focus ring without layout shift */ }
.sto-card[aria-disabled='true'] { /* explicit disabled tokens */ }

.sto-control { /* default */ }
.sto-control:hover { /* hover */ }
.sto-control:active,
.sto-control[data-state='active'] { /* active */ }
.sto-control:focus-visible { /* focus */ }
.sto-control:disabled,
.sto-control[aria-disabled='true'] { /* disabled */ }
.sto-control[data-state='loading'] { /* loading */ }
.sto-control[aria-invalid='true'],
.sto-control[data-state='error'] { /* error */ }
```

Create equivalent semantic families for `.sto-navigation-item`, `.sto-segment-item`, `.sto-overlay`, and `.sto-feedback`.

- [ ] Map existing primitive variants to recipe classes without changing public props. For example:

```ts
const buttonRecipeClass = {
  default: 'sto-control sto-control--primary',
  destructive: 'sto-control sto-control--destructive',
  outline: 'sto-control sto-control--outline',
  secondary: 'sto-control sto-control--secondary',
  ghost: 'sto-control sto-control--ghost',
  link: 'sto-control sto-control--link',
} as const
```

- [ ] Remove recipe-equivalent literals and duplicate state declarations from primitives after consumers are mapped. Do not retain aliases with zero consumers.

- [ ] Rerun focused tests and visual comparison, then commit:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/theme-computed-styles.test.tsx \
  tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-control-recipes.test.ts \
  tests/unit/sto-neutral-controls.test.tsx
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
git add src/styles/theme src/lib/surfaces.ts src/components/ui \
  tests/unit/theme-computed-styles.test.tsx tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-control-recipes.test.ts tests/unit/sto-neutral-controls.test.tsx
git commit -m "refactor: define complete shared theme recipes"
```

## Task 6: Unify Shell, Sidebar, and Collection Cards with Keyboard Safety

**Files:**

- Create: `src/components/ui/collection-card-action.tsx`
- Modify: `src/lib/surfaces.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/sidebar-header-toggle.tsx`
- Modify: `src/components/layout/sidebar-project-row-trailing.tsx`
- Modify: `src/components/layout/sidebar-projects-section.tsx`
- Modify: `src/components/more-apps/AppCard.tsx`
- Modify: `src/components/more-apps/MoreAppsPage.tsx`
- Modify: `src/components/skill-plaza/SkillCard.tsx`
- Modify: `src/components/skill-plaza/SkillPlazaCategoryNav.tsx`
- Modify: `src/components/connectors/ConnectorCard.tsx`
- Modify: `src/components/workflow/WorkflowPicker.tsx`
- Modify: `src/pages/MyTask/components/TaskCard.tsx`
- Create: `tests/unit/collection-card-action.test.tsx`
- Modify: relevant existing sidebar, plaza, connector, workflow, and task-card tests

- [ ] Write failing keyboard tests for a shared overlay action. Tab must focus it; Enter and Space must trigger the primary card action once; an inner secondary button must not trigger the card action.

```tsx
render(
  <article className="sto-collection-card">
    <h3>Card title</h3>
    <CollectionCardAction aria-label="Open Card title" onClick={onOpen} />
    <button onClick={onSecondary}>More</button>
  </article>,
)
```

- [ ] Confirm the new test fails because the component does not exist:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/collection-card-action.test.tsx
```

- [ ] Implement the minimal typed component:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function CollectionCardAction({
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn('sto-collection-card__action', className)}
      {...props}
    />
  )
}
```

The overlay action must not wrap card contents. Secondary actions remain sibling buttons above it in stacking order, preventing nested interactive elements.

- [ ] Add shared collection-card focus treatment in `recipes.css`:

```css
.sto-collection-card {
  position: relative;
}

.sto-collection-card:has(.sto-collection-card__action:focus-visible) {
  box-shadow: 0 0 0 2px var(--sto-focus-ring);
}

.sto-collection-card__action {
  position: absolute;
  inset: 0;
  border: 0;
  background: transparent;
}
```

- [ ] Migrate App, Skill, Connector, Workflow, and Task collection shells to the same Card recipe while preserving each card's existing content, size, media, metadata, and secondary actions.

- [ ] Migrate sidebar rows and selected items to Navigation recipes. The dark hierarchy must remain canvas `#0D0D0D`, sidebar `#212121`, selected/elevated `#282828`; the approved light sidebar must remain pixel-identical.

- [ ] Run focused interaction tests, the existing surface tests, and visual comparison:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/collection-card-action.test.tsx \
  tests/unit/app-shell-surface-tokens.test.ts \
  tests/unit/theme-card-recipes.test.ts
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
```

- [ ] Commit only the listed shell/card files and tests:

```bash
git add src/components/ui/collection-card-action.tsx src/lib/surfaces.ts \
  src/components/layout src/components/more-apps src/components/skill-plaza \
  src/components/connectors/ConnectorCard.tsx src/components/workflow/WorkflowPicker.tsx \
  src/pages/MyTask/components/TaskCard.tsx tests/unit/collection-card-action.test.tsx
git commit -m "refactor: unify navigation and collection cards"
```

## Task 7: Normalize Chat, Forms, Overlays, Tables, and Neutral Shadows

**Files:**

- Modify: `src/styles/globals.css`
- Modify: `src/styles/theme/tokens.css`
- Modify: `src/styles/theme/recipes.css`
- Modify: `src/lib/surfaces.ts`
- Modify: `src/components/chat/artifact-product-card.tsx`
- Modify: `src/components/chat/chat-process-block.tsx`
- Modify: `src/components/chat/chat-tool-call-card.tsx`
- Modify: `src/components/input-composer/input-composer-shell.tsx`
- Modify: `src/components/parameter-form/FormFieldRenderer.tsx`
- Modify: `src/components/parameter-form/OptionCardList.tsx`
- Modify: `src/components/parameter-form/ParameterFormCard.tsx`
- Modify: `src/components/quick-input/QuickInputManageListItem.tsx`
- Modify: `src/components/quick-input/QuickInputManageModal.tsx`
- Modify: `src/components/quick-input/QuickInputPicker.tsx`
- Modify if reported by the audit: `src/components/attachments/ComposerAttachMenu.tsx`
- Modify if reported by the audit: `src/components/channels/ChannelConfigModal.tsx`
- Modify if reported by the audit: `src/components/channels/DingTalkHubBindModal.tsx`
- Modify if reported by the audit: `src/components/channels/MobileAppConfigModal.tsx`
- Modify if reported by the audit: `src/components/file-preview/ArtifactShareDialog.tsx`
- Modify if reported by the audit: `src/components/file-preview/SaveArtifactDialog.tsx`
- Modify if reported by the audit: `src/components/input-composer/input-composer-agent-picker.tsx`
- Modify if reported by the audit: `src/components/jsbridge/JsBridgeHostPortal.tsx`
- Modify if reported by the audit: `src/components/layout/SidebarMobileConnectTooltip.tsx`
- Modify if reported by the audit: `src/components/layout/TitleBar.tsx`
- Modify if reported by the audit: `src/components/layout/sidebar-update-notice.tsx`
- Modify if reported by the audit: `src/components/settings/DwsCliSettings.tsx`
- Modify if reported by the audit: `src/components/settings/ProvidersSettings.tsx`
- Modify if reported by the audit: `src/components/skill-plaza/SkillIcon.tsx`
- Modify if reported by the audit: `src/components/ui/confirm-dialog.tsx`
- Modify if reported by the audit: `src/components/ui/sheet.tsx`
- Modify if reported by the audit: `src/components/ui/tooltip.tsx`
- Modify: `src/pages/Chat/ChatEngineModelSelectors.tsx`
- Modify: `src/pages/Chat/ChatMessage.tsx`
- Modify: `src/pages/Chat/ChatSearchBar.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/thinking/thinking-turn-process.tsx`
- Modify if reported by the audit: `src/pages/Agents/AgentDetailPage.tsx`
- Modify if reported by the audit: `src/pages/Agents/index.tsx`
- Modify if reported by the audit: `src/pages/DataCenter/components/entries.tsx`
- Modify if reported by the audit: `src/pages/DataCenter/components/modals.tsx`
- Modify if reported by the audit: `src/pages/Login/index.tsx`
- Modify if reported by the audit: `src/pages/Models/TokenQuotaDialog.tsx`
- Modify if reported by the audit: `src/pages/Models/index.tsx`
- Modify if reported by the audit: `src/pages/Settings/index.tsx`
- Modify if reported by the audit: `src/pages/Setup/index.tsx`
- Modify if reported by the audit: `src/pages/Skills/index.tsx`
- Modify if reported by the audit: `src/pages/Sprite/QuickActions.tsx`
- Modify if reported by the audit: `src/pages/Sprite/SpriteInput.tsx`
- Modify if reported by the audit: `src/pages/Sprite/index.tsx`
- Modify if reported by the audit: `src/pages/Subscriptions/index.tsx`
- Modify: `tests/unit/dark-appearance-surface-guard.test.ts`
- Modify: `tests/unit/theme-source-audit.test.ts`

- [ ] Extend the source audit with failing assertions for cool-tinted dark glass and ordinary brand-colored shadows:

```ts
expect(violations.coolDarkShadow).toEqual([])
expect(violations.ordinaryBrandGlow).toEqual([])
```

The brand-glow exception is limited to explicit brand artwork or functional focus/error feedback, never ordinary card, input, table, dialog, or message shadows.

- [ ] Run the guard and confirm it reports the current cool shadows and local surface literals:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/dark-appearance-surface-guard.test.ts \
  tests/unit/theme-source-audit.test.ts
```

- [ ] Replace chat process/title/body/icon colors with semantic text roles. Thinking headings, process metadata, tool cards, tables, and generated Markdown must meet WCAG AA for ordinary text; large text must meet the applicable large-text threshold.

- [ ] Migrate forms, option cards, quick-input components, dialogs, sheets, tooltips, and dropdowns to Control/Overlay recipes. Preserve validation behavior and status colors.

- [ ] Replace cool dark shadows with neutral dark shadows or no shadow. Keep the approved light shadow via semantic shadow variables so light screenshots remain unchanged.

- [ ] Ensure generated Markdown tables use semantic background, header, row, text, and border variables. No cell may combine a light background with near-white text in dark mode.

- [ ] Run focused tests, the full static visual comparison, and update the real-page evidence rows for Chat, Rich Content, and Overlay:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/dark-appearance-surface-guard.test.ts \
  tests/unit/theme-computed-styles.test.tsx \
  tests/unit/theme-source-audit.test.ts
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
```

- [ ] Stage only files actually changed in this task, inspect the staged list, and commit:

```bash
git diff --name-only
git add src/styles src/lib/surfaces.ts src/components/chat src/components/input-composer \
  src/components/parameter-form src/components/quick-input src/pages/Chat \
  tests/unit/dark-appearance-surface-guard.test.ts tests/unit/theme-source-audit.test.ts \
  tests/visual/approved-page-matrix.md
git diff --cached --check
git commit -m "style: normalize content and overlay theme states"
```

## Task 8: Migrate Feature Styles Without Page-Level Dark Palettes

**Files:**

- Modify: `src/components/more-apps/more-apps.css`
- Modify: `src/components/more-apps/app-plaza-shell.css`
- Modify: `src/components/sclaw-browser/sclaw-browser-overlay.css`
- Modify: `src/pages/WorkflowDesigner/workflow-designer-canvas.css`
- Modify: `src/pages/WorkflowDesigner/workflow-designer.tsx`
- Modify: `src/pages/WorkflowDesigner/components/history-versions-drawer.tsx`
- Modify: `src/pages/WorkflowDesigner/components/local-run-history-dialog.tsx`
- Modify: `src/pages/WorkflowDesigner/components/startup-run-dialog.tsx`
- Modify: `src/pages/WorkflowDesigner/components/test-run-trial-view.tsx`
- Modify: `src/pages/MyTask/components/TaskCreateModal.tsx`
- Modify: `src/components/workflow/WorkflowPicker.tsx`
- Modify: `tests/unit/theme-source-audit.test.ts`
- Modify: relevant existing Workflow and Task tests

- [ ] Add exact-file assertions proving each feature stylesheet contains no `.dark` selector and each listed TSX file contains no color-bearing `dark:` utility.

- [ ] Run the audit and confirm these feature files fail before migration:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/theme-source-audit.test.ts \
  tests/unit/test-run-drawer.test.tsx
```

- [ ] Replace feature-local palettes with semantic variables and shared recipes. Keep feature-only layout selectors, canvas geometry, workflow node positioning, browser behavior, task behavior, and app-plaza content untouched.

- [ ] Remove aliases only after proving zero consumers:

```bash
rg -n -- '--sto-[a-z0-9-]+' src/components src/pages src/styles
```

For every deleted alias, run a second exact-name search and require zero results before deletion.

- [ ] Run Workflow/Task tests, source audit, static screenshots, and update the App Plaza and Tasks/Workflow evidence rows:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/theme-source-audit.test.ts \
  tests/unit/test-run-drawer.test.tsx
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
```

- [ ] Commit the feature migration:

```bash
git add src/components/more-apps src/components/sclaw-browser \
  src/pages/WorkflowDesigner src/pages/MyTask/components/TaskCreateModal.tsx \
  src/components/workflow/WorkflowPicker.tsx tests/unit/theme-source-audit.test.ts \
  tests/unit/test-run-drawer.test.tsx tests/visual/approved-page-matrix.md
git diff --cached --check
git commit -m "refactor: migrate feature styles to theme semantics"
```

## Task 9: Verify Adaptive/Fidelity Preview and Native Window Propagation

**Files:**

- Modify: `src/lib/preview-srcdoc.ts`
- Modify: `src/components/file-preview/WordDocViewer.tsx`
- Modify only if native tests expose a defect: `electron/main/appearance.ts`
- Modify only if native tests expose a defect: `electron/main/appearance-replay.ts`
- Modify only if native tests expose a defect: `electron/main/index.ts`
- Modify only if native tests expose a defect: `electron/main/sprite-window.ts`
- Modify only if native tests expose a defect: `electron/main/float-icon-window.ts`
- Modify: `tests/unit/preview-srcdoc.test.ts`
- Modify: `tests/unit/native-appearance.test.ts`
- Modify: `tests/unit/theme-controller.test.tsx`
- Modify: `tests/unit/host-events.test.ts`
- Modify: `tests/visual/approved-page-matrix.md`

- [ ] Add preview tests that distinguish rendering intent:

```ts
it('injects semantic tokens into adaptive HTML', () => {
  const html = prepareInlinePreviewSrcDoc(
    '<table><tr><td>A</td></tr></table>',
    { appearance: 'dark', mode: 'adaptive' },
  )
  expect(html).toContain('data-sto-preview-theme')
  expect(html).toContain('var(--sto-text-primary)')
})

it('does not recolor fidelity content', () => {
  const html = prepareInlinePreviewSrcDoc(
    '<main style="background:#fff">Paper</main>',
    { appearance: 'dark', mode: 'fidelity' },
  )
  expect(html).toContain('data-sto-preview-mode="fidelity"')
  expect(html).not.toContain('data-sto-preview-mode="adaptive"')
})
```

- [ ] Add native-window tests covering explicit Light, explicit Dark, System resolving to light, System resolving to dark, live OS-theme change, main window, sprite/float window, and a window created after a theme change.

- [ ] Run the tests and confirm any missing preview/native scenario fails before implementation:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/preview-srcdoc.test.ts
```

Then run the exact native appearance set; do not invent a second propagation path:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/native-appearance.test.ts \
  tests/unit/theme-controller.test.tsx \
  tests/unit/host-events.test.ts
```

- [ ] Make Markdown/generated HTML Adaptive and reuse semantic tokens. Keep image, PDF, PPT, Word, and other document-canvas previews Fidelity by default. Correct any Word fallback that currently routes document content through Adaptive mode.

- [ ] If native tests already pass, do not modify Electron runtime files. If a test fails, fix the existing single propagation path and keep renderer business components unaware of native theme transport.

- [ ] Manually verify and record Light/Dark/System evidence for Adaptive table content and Fidelity document content. Fidelity white paper is expected and must not be darkened.

- [ ] Run preview tests, all located appearance tests, static screenshots, and commit only files actually changed:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run tests/unit/preview-srcdoc.test.ts
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
git diff --name-only
git add src/lib/preview-srcdoc.ts src/components/file-preview/WordDocViewer.tsx \
  tests/unit/preview-srcdoc.test.ts tests/unit/native-appearance.test.ts \
  tests/unit/theme-controller.test.tsx tests/unit/host-events.test.ts \
  tests/visual/approved-page-matrix.md
git diff --cached --check
git commit -m "fix: preserve adaptive and fidelity theme intent"
```

If the Word preview or existing Electron appearance files were changed, stage those exact paths only after `git diff --name-only` confirms they belong to this task.

## Task 10: Remove Temporary Exceptions and Prove the Final Contract

**Files:**

- Modify: `src/styles/theme/tokens.css`
- Modify: `src/styles/theme/recipes.css`
- Modify: `src/styles/globals.css`
- Modify: `tests/unit/theme-source-audit.test.ts`
- Modify: `tests/unit/theme-system-contract.test.ts`
- Modify: `tests/visual/approved-page-matrix.md`
- Modify: `.cursor/rules/02-styles.mdc`
- Delete: dead theme aliases, dead duplicate recipes, and temporary audit allowlist entries with zero justified consumers

- [ ] Tighten the source audit so migration allowances are removed. The only remaining raw-color exceptions must be documented brand assets, approved functional status colors, or Fidelity content.

- [ ] Prove ordinary production sources contain no page-owned dark palette:

```bash
if rg -n "dark:(bg|text|border|shadow|ring)-" src --glob '*.{ts,tsx}'; then exit 1; fi
if rg -n '^\s*\.dark\b' src --glob '*.css' --glob '!styles/theme/tokens.css'; then exit 1; fi
if rg -n 'rgba\(\s*(2\s*,\s*8\s*,\s*23|15\s*,\s*23\s*,\s*42)' src --glob '*.{css,ts,tsx}'; then exit 1; fi
```

- [ ] Prove the preview has no duplicate theme palette:

```bash
rg -n -- '--sto-(canvas|panel|sidebar|elevated|text-primary|text-secondary|border):' src/lib/preview-srcdoc.ts && exit 1 || true
rg -n "tokens.css\?raw" src/lib/preview-srcdoc.ts
```

- [ ] Search for unused theme aliases and recipe selectors. For each candidate, verify zero production consumers before removing it:

```bash
rg -n -- '--sto-[a-z0-9-]+' src/styles/theme src/styles/globals.css
rg -n 'sto-(card|control|navigation|segment|overlay|feedback|collection-card)' src
```

- [ ] Update `.cursor/rules/02-styles.mdc` with the final enforceable rules:

  - `tokens.css` is the only light/dark/system mapping owner.
  - `recipes.css` is the only shared interaction-state color owner.
  - pages may define layout but not dark palettes.
  - new equivalent cards use the shared collection-card recipe and keyboard-safe action.
  - Adaptive content inherits semantic tokens; Fidelity content preserves authored appearance.
  - every new interactive component implements the complete state chain.

- [ ] Complete every Light, Dark, and System cell in `approved-page-matrix.md`. Record evidence for sidebar hierarchy, card consistency, table legibility, overlay contrast, Adaptive/Fidelity previews, and native windows.

- [ ] Run the complete relevant unit suite:

```bash
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run \
  tests/unit/app-shell-surface-tokens.test.ts \
  tests/unit/collection-card-action.test.tsx \
  tests/unit/dark-appearance-surface-guard.test.ts \
  tests/unit/dark-appearance-tokens.test.ts \
  tests/unit/light-appearance-tokens.test.ts \
  tests/unit/preview-srcdoc.test.ts \
  tests/unit/sto-neutral-controls.test.tsx \
  tests/unit/theme-approved-baseline.test.ts \
  tests/unit/theme-card-recipes.test.ts \
  tests/unit/theme-computed-styles.test.tsx \
  tests/unit/theme-control-recipes.test.ts \
  tests/unit/theme-source-audit.test.ts \
  tests/unit/theme-system-contract.test.ts \
  tests/unit/test-run-drawer.test.tsx
```

- [ ] Run the static pixel comparison:

```bash
../../node_modules/.bin/electron tests/visual/theme-screenshot-runner.cjs
```

- [ ] Run lint and type checking without installation or configuration changes:

```bash
../../node_modules/.bin/eslint src tests --max-warnings=0
../../node_modules/.bin/tsc --noEmit
```

If repository-wide pre-existing failures occur, record them separately and rerun the commands scoped to every changed source/test file. Do not hide new failures behind existing failures.

- [ ] Enforce the active production-code budget relative to the exact checkpoint tag:

```bash
git diff --numstat theme-approved-baseline-20260830 -- \
  ':(glob)src/**/*.css' ':(glob)src/**/*.ts' ':(glob)src/**/*.tsx'
git diff --numstat theme-approved-baseline-20260830 -- \
  ':(glob)src/**/*.css' ':(glob)src/**/*.ts' ':(glob)src/**/*.tsx' \
  | awk '{ added += $1; deleted += $2 } END { print "added=" added, "deleted=" deleted, "net=" added-deleted; exit (added-deleted > 0) }'
```

The command must report `net=0` or a negative number. If positive, consolidate repeated declarations, remove dead aliases, and rerun all focused tests before proceeding.

- [ ] Inspect the final diff for forbidden unrelated changes:

```bash
git diff --name-only theme-approved-baseline-20260830
git diff -- resources/dws/manifest.json package.json pnpm-lock.yaml vite.config.ts vitest.config.ts electron-builder.yml .github/workflows
git diff --check theme-approved-baseline-20260830
```

The second command must be empty for changes introduced by this implementation.

- [ ] Invoke `superpowers:requesting-code-review` and resolve every correctness, accessibility, theme-coverage, or maintainability finding. Rerun the impacted checks after each fix.

- [ ] Run the frontend build only from the AGENTS-authorized source project after transferring the reviewed branch according to the repository's normal integration workflow:

```bash
cd /Users/zzj/Desktop/workspace/sto/backend-project/sto-claw/
pnpm run build:vite
```

Do not run installation, dependency updates, packaging configuration changes, or build-script edits.

- [ ] Commit final cleanup and evidence:

```bash
git add src/styles/theme src/styles/globals.css tests/unit/theme-source-audit.test.ts \
  tests/unit/theme-system-contract.test.ts tests/visual/approved-page-matrix.md \
  .cursor/rules/02-styles.mdc
git diff --cached --check
git commit -m "refactor: complete optimal theme system"
```

- [ ] Produce the handoff with:

  - exact test, lint, typecheck, screenshot, and build results;
  - final production-code added/deleted/net counts;
  - confirmation that approved light pixels are unchanged;
  - confirmation of zero ordinary page `.dark` selectors and color-bearing `dark:` utilities;
  - the completed real-page evidence matrix;
  - any pre-existing unrelated dirty paths kept out of all theme commits.
