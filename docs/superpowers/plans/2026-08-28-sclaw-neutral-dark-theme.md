# SClaw Neutral Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade SClaw's dark appearance to a unified neutral, low-contrast system across native windows, renderer surfaces, shared controls, and adaptive HTML previews while preserving the current light appearance.

**Architecture:** Keep `light | dark | system` as the only persisted preference. A renderer `ThemeController` resolves that preference once, applies it to the document, and broadcasts it to adaptive previews; a Main-process appearance module maps the same persisted preference to Electron `nativeTheme` and native window backgrounds. Semantic CSS tokens and small presentational `Sto*` controls replace page-local dark patches without moving page business logic into shared components.

**Tech Stack:** Electron, React 19, TypeScript, Tailwind CSS, Zustand, Radix UI, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-28-sclaw-neutral-dark-theme-design.md`

## Global Constraints

- Only the dark appearance changes visually; existing light colors, spacing, layout, and interaction behavior remain unchanged.
- Retain SClaw orange (`--sto-brand-6: #ff6f00`) as the product accent.
- New theme code must use SClaw-owned names (`Sto*`, `sto-*`, `surface-*`, `appearance-*`); do not add external product names to identifiers, classes, data attributes, comments, logs, tests, or runtime output.
- Do not modify dependency versions, `package.json` package-manager fields, lockfiles, build/pack scripts, build configuration, or CI/CD files.
- Do not run package-manager install, update, upgrade, remove, or prune commands.
- Renderer backend calls remain behind `src/lib/host-api.ts` and `src/lib/api-client.ts`; do not add direct renderer IPC calls.
- Follow React 19 rules: do not add `useCallback`, `useMemo`, or `React.memo` unless an existing documented exception applies.
- Adaptive HTML may follow the app appearance; fidelity previews (PPT slides, Word paper, images, authored external pages) must preserve document colors.
- Preserve the existing OpenAI Provider/OAuth protocol identifiers; they are unrelated to theme naming and are out of scope.

---

### Task 1: Establish neutral semantic tokens and compatibility aliases

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/lib/surfaces.ts`
- Modify: `tests/unit/app-shell-surface-tokens.test.ts`
- Create: `tests/unit/dark-appearance-tokens.test.ts`

**Interfaces:**
- Consumes: existing `:root`, `.dark`, `--sto-shell-bg`, `--sto-workspace-bg`, and `--sto-panel-bg` contracts.
- Produces: `--sto-surface-under`, `--sto-surface-primary`, `--sto-surface-secondary`, `--sto-surface-elevated`, `--sto-control-bg`, `--sto-control-hover-bg`, `--sto-control-active-bg`, `--sto-text-primary`, `--sto-text-secondary`, `--sto-text-tertiary`, `--sto-border-light`, `--sto-border-default`, and `--sto-border-heavy`; neutral shared class exports with `myTask*` compatibility aliases.

- [ ] **Step 1: Write failing token tests**

Add assertions that the light block keeps the current values and only aliases them, while the dark block contains the exact approved palette:

```ts
it('keeps light surfaces unchanged and exposes semantic aliases', () => {
  const root = extractBlock(globalsCss, ':root {');
  expect(root).toContain('--sto-shell-bg: #ededed');
  expect(root).toContain('--sto-workspace-bg: #fafafa');
  expect(root).toContain('--sto-panel-bg: #ffffff');
  expect(root).toMatch(/--sto-surface-under:\s*var\(--sto-shell-bg\)/);
  expect(root).toMatch(/--sto-surface-primary:\s*var\(--sto-workspace-bg\)/);
  expect(root).toMatch(/--sto-surface-secondary:\s*var\(--sto-panel-bg\)/);
});

it('maps dark appearance to the approved neutral palette', () => {
  const dark = extractBlock(globalsCss, '.dark {');
  expect(dark).toContain('--sto-surface-under: #0d0d0d');
  expect(dark).toContain('--sto-surface-primary: #181818');
  expect(dark).toContain('--sto-surface-secondary: #212121');
  expect(dark).toContain('--sto-surface-elevated: #282828');
  expect(dark).toContain('--sto-text-primary: #dfdfdf');
  expect(dark).toContain('--sto-border-default: rgba(255, 255, 255, 0.08)');
});
```

- [ ] **Step 2: Run the token tests and confirm failure**

Run: `pnpm test -- tests/unit/app-shell-surface-tokens.test.ts tests/unit/dark-appearance-tokens.test.ts`

Expected: FAIL because the new semantic variables and aliases do not exist.

- [ ] **Step 3: Add semantic variables without changing light values**

In `:root`, point new variables at existing light values. In `.dark`, set the approved exact values and remap legacy aliases:

```css
:root {
  --sto-surface-under: var(--sto-shell-bg);
  --sto-surface-primary: var(--sto-workspace-bg);
  --sto-surface-secondary: var(--sto-panel-bg);
  --sto-surface-elevated: #ffffff;
  --sto-control-bg: var(--sto-panel-bg);
  --sto-control-hover-bg: #f2f3f5;
  --sto-control-active-bg: #e5e6eb;
  --sto-text-primary: #1d2129;
  --sto-text-secondary: #4e5969;
  --sto-text-tertiary: #86909c;
  --sto-border-light: rgba(29, 33, 41, 0.04);
  --sto-border-default: #e5e6eb;
  --sto-border-heavy: #c9cdd4;
}

.dark {
  color-scheme: dark;
  --background: 0 0% 9.4%;
  --foreground: 0 0% 87.5%;
  --card: 0 0% 12.9%;
  --card-foreground: 0 0% 87.5%;
  --popover: 0 0% 15.7%;
  --popover-foreground: 0 0% 87.5%;
  --secondary: 0 0% 12.9%;
  --secondary-foreground: 0 0% 87.5%;
  --muted: 0 0% 15.7%;
  --muted-foreground: 0 0% 70%;
  --border: 0 0% 100% / 0.08;
  --input: 0 0% 100% / 0.08;
  --sto-surface-under: #0d0d0d;
  --sto-surface-primary: #181818;
  --sto-surface-secondary: #212121;
  --sto-surface-elevated: #282828;
  --sto-control-bg: #212121;
  --sto-control-hover-bg: #282828;
  --sto-control-active-bg: #282828;
  --sto-text-primary: #dfdfdf;
  --sto-text-secondary: rgba(255, 255, 255, 0.70);
  --sto-text-tertiary: rgba(255, 255, 255, 0.50);
  --sto-border-light: rgba(255, 255, 255, 0.04);
  --sto-border-default: rgba(255, 255, 255, 0.08);
  --sto-border-heavy: rgba(255, 255, 255, 0.16);
  --sto-shell-bg: var(--sto-surface-under);
  --sto-workspace-bg: var(--sto-surface-primary);
  --sto-panel-bg: var(--sto-surface-secondary);
}
```

Do not change the existing light declarations for `--background`, `--card`, `--popover`, L0/L1/L2, or the orange brand.

- [ ] **Step 4: Add neutral surface classes and compatibility aliases**

In `src/lib/surfaces.ts`, add neutral exports and map existing `myTask*` exports to them:

```ts
export const stoSegmentTabsTrackClass =
  'inline-flex w-fit flex-shrink-0 items-center gap-0.5 rounded-[12px] bg-[#EDEDED] p-0.5 dark:bg-[var(--sto-surface-secondary)]';

export function stoSegmentTabClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-[7px] font-['PingFang_SC'] text-[14px] font-medium leading-none transition-colors duration-150",
    active
      ? 'bg-white text-[#1A1A1A] dark:bg-[var(--sto-control-active-bg)] dark:text-[var(--sto-text-primary)]'
      : 'bg-transparent text-[#4E5969] hover:bg-black/[0.04] hover:text-[#1D2129] dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-control-hover-bg)] dark:hover:text-[var(--sto-text-primary)]',
  );
}

export const myTaskSectionTabsTrackClass = stoSegmentTabsTrackClass;
export function myTaskSectionTabClass(active: boolean): string {
  return stoSegmentTabClass(active);
}
```

Add the remaining neutral exports. Keep sizing outside the base class so pages preserve their existing 34 px/36 px light layouts:

```ts
export const stoOutlineButtonBaseClass = cn(
  "inline-flex items-center justify-center rounded-[12px] border border-[#E8EAEF] bg-white font-['PingFang_SC'] text-[13px] font-medium leading-none text-[#1D2129]",
  'transition-colors duration-150 hover:bg-[#F2F3F5]',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)] dark:hover:bg-[var(--sto-control-hover-bg)]',
);
export const stoSearchFieldShellClass = cn(
  'flex items-center gap-2 rounded-[12px] border border-border bg-white px-3',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)]',
);
export const stoSortTriggerClass = cn(
  'flex items-center gap-[6px] rounded-[10px] border border-border bg-white text-[#1D2129]',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)] dark:hover:bg-[var(--sto-control-hover-bg)]',
);
export const stoIconSurfaceClass = cn(
  'flex shrink-0 items-center justify-center rounded-lg border border-border bg-white text-[#1D2129]',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:text-[var(--sto-text-primary)]',
);
export const stoNeutralCardClass = cn(
  'border border-border bg-white',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-secondary)]',
);
export const myTaskCreateButtonClass = cn(
  stoOutlineButtonBaseClass,
  'h-[34px] shrink-0 gap-1.5 px-3.5 text-sm',
);
export const myTaskSortTriggerClass = cn(
  stoSortTriggerClass,
  'h-[34px] px-[10px] text-[13px]',
  formFieldHoverBorderClass,
  formFieldFocusVisibleClass,
);
```

Preserve the exact existing light-side class fragments in compatibility aliases; only replace their dark branches.

- [ ] **Step 5: Run tests and type checking**

Run: `pnpm test -- tests/unit/app-shell-surface-tokens.test.ts tests/unit/dark-appearance-tokens.test.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the token layer**

```bash
git add src/styles/globals.css src/lib/surfaces.ts tests/unit/app-shell-surface-tokens.test.ts tests/unit/dark-appearance-tokens.test.ts
git commit -m "feat: add neutral dark appearance tokens"
```

---

### Task 2: Centralize renderer appearance resolution and iframe broadcasting

**Files:**
- Modify: `src/hooks/use-resolved-appearance.ts`
- Create: `src/components/theme/ThemeController.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Sprite/index.tsx`
- Modify: `src/pages/FloatIcon/index.tsx`
- Create: `tests/unit/theme-controller.test.tsx`

**Interfaces:**
- Consumes: `useSettingsStore((state) => state.theme)` and the existing `ResolvedAppearance = 'light' | 'dark'` type.
- Produces: `STO_APPEARANCE_MESSAGE_TYPE`, `applyResolvedAppearance(root, appearance)`, `postResolvedAppearance(target, appearance)`, and `<ThemeController />`.

- [ ] **Step 1: Write failing controller tests**

```tsx
it('applies class, data attribute, and color scheme together', () => {
  const root = document.documentElement;
  applyResolvedAppearance(root, 'dark');
  expect(root).toHaveClass('dark');
  expect(root).not.toHaveClass('light');
  expect(root.dataset.theme).toBe('dark');
  expect(root.style.colorScheme).toBe('dark');
});

it('uses an SClaw-owned message name', () => {
  expect(STO_APPEARANCE_MESSAGE_TYPE).toBe('sto:appearance-change');
});

it('posts the resolved appearance to a preview window', () => {
  const postMessage = vi.fn();
  postResolvedAppearance({ postMessage } as unknown as Window, 'light');
  expect(postMessage).toHaveBeenCalledWith(
    { type: 'sto:appearance-change', appearance: 'light' },
    '*',
  );
});
```

- [ ] **Step 2: Run the controller test and confirm failure**

Run: `pnpm test -- tests/unit/theme-controller.test.tsx`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement pure appearance helpers and the controller**

Keep `useResolvedAppearance()` as the sole `matchMedia` subscriber. Implement the controller without adding memoization wrappers:

```tsx
export const STO_APPEARANCE_MESSAGE_TYPE = 'sto:appearance-change' as const;

export function applyResolvedAppearance(root: HTMLElement, appearance: ResolvedAppearance): void {
  root.classList.remove('light', 'dark');
  root.classList.add(appearance);
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
}

export function postResolvedAppearance(target: Window, appearance: ResolvedAppearance): void {
  target.postMessage({ type: STO_APPEARANCE_MESSAGE_TYPE, appearance }, '*');
}

export function ThemeController() {
  const appearance = useResolvedAppearance();
  useEffect(() => {
    applyResolvedAppearance(document.documentElement, appearance);
    document
      .querySelectorAll<HTMLIFrameElement>('iframe[data-sto-theme-sync="true"]')
      .forEach((frame) => {
        if (frame.contentWindow) postResolvedAppearance(frame.contentWindow, appearance);
      });
  }, [appearance]);
  return null;
}
```

- [ ] **Step 4: Mount the controller once and remove duplicate effects**

Mount `<ThemeController />` once inside `App` before route rendering. Remove the theme class effects and unused `theme` selectors from `App.tsx`, `Sprite/index.tsx`, and `FloatIcon/index.tsx`. Keep their independent settings initialization and transparent-window styles intact.

- [ ] **Step 5: Verify renderer behavior**

Run: `pnpm test -- tests/unit/theme-controller.test.tsx tests/unit/stores.test.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS with no hook dependency warnings introduced by the new controller.

- [ ] **Step 6: Commit renderer control**

```bash
git add src/hooks/use-resolved-appearance.ts src/components/theme/ThemeController.tsx src/App.tsx src/pages/Sprite/index.tsx src/pages/FloatIcon/index.tsx tests/unit/theme-controller.test.tsx
git commit -m "feat: centralize renderer appearance control"
```

---

### Task 3: Synchronize Electron native appearance and startup background

**Files:**
- Create: `electron/main/appearance.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/api/routes/settings.ts`
- Create: `tests/unit/native-appearance.test.ts`

**Interfaces:**
- Consumes: persisted `AppSettings['theme']`, Electron `nativeTheme`, and `BrowserWindow.getAllWindows()`.
- Produces: `LIGHT_WINDOW_BACKGROUND`, `DARK_WINDOW_BACKGROUND`, `resolveWindowBackgroundColor(isDark)`, `applyNativeAppearancePreference(theme)`, `syncNativeAppearanceFromStore()`, and `observeNativeAppearanceUpdates()`.

- [ ] **Step 1: Write failing native appearance tests**

Mock Electron and assert preference/background mapping:

```ts
it('maps native darkness to the approved shell colors', () => {
  expect(resolveWindowBackgroundColor(false)).toBe('#ededed');
  expect(resolveWindowBackgroundColor(true)).toBe('#0d0d0d');
});

it.each(['light', 'dark', 'system'] as const)('accepts the persisted %s preference', (theme) => {
  applyNativeAppearancePreference(theme);
  expect(nativeTheme.themeSource).toBe(theme);
});
```

The Electron mock must provide `nativeTheme.themeSource`, `nativeTheme.shouldUseDarkColors`, `nativeTheme.on/removeListener`, and `BrowserWindow.getAllWindows()` returning windows with `isDestroyed()` and `setBackgroundColor()`. Mock `getSpriteWindow()` and `getFloatIconWindow()` separately so the test proves transparent windows are skipped.

- [ ] **Step 2: Run the native appearance test and confirm failure**

Run: `pnpm test -- tests/unit/native-appearance.test.ts`

Expected: FAIL because `electron/main/appearance.ts` does not exist.

- [ ] **Step 3: Implement Main-owned native synchronization**

```ts
export const LIGHT_WINDOW_BACKGROUND = '#ededed';
export const DARK_WINDOW_BACKGROUND = '#0d0d0d';

export function resolveWindowBackgroundColor(isDark: boolean): string {
  return isDark ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

function updateOpaqueWindowBackgrounds(): void {
  const background = resolveWindowBackgroundColor(nativeTheme.shouldUseDarkColors);
  const transparentWindows = new Set([getSpriteWindow(), getFloatIconWindow()]);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !transparentWindows.has(win)) win.setBackgroundColor(background);
  }
}

export function applyNativeAppearancePreference(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme;
  updateOpaqueWindowBackgrounds();
}
```

`syncNativeAppearanceFromStore()` reads `getSetting('theme')`. `observeNativeAppearanceUpdates()` subscribes once to `nativeTheme`'s `updated` event and returns a cleanup function.

- [ ] **Step 4: Apply appearance before creating the main window**

In `initialize()`, call `await syncNativeAppearanceFromStore()` before `createMainWindow()`. Replace the fixed `'#0f1525'` main-window background with `resolveWindowBackgroundColor(nativeTheme.shouldUseDarkColors)`. Register the native update observer once during app-ready initialization; do not apply opaque backgrounds to Sprite or FloatIcon transparent windows.

- [ ] **Step 5: Sync settings writes and reset**

In both settings PUT paths, when the changed key/patch contains `theme`, validate the value as `light | dark | system`, persist it, then call `applyNativeAppearancePreference(value)`. After `/api/settings/reset`, call `syncNativeAppearanceFromStore()`.

Invalid theme values must return HTTP 400 and must not reach `nativeTheme.themeSource`.

```ts
function isThemePreference(value: unknown): value is AppSettings['theme'] {
  return value === 'light' || value === 'dark' || value === 'system';
}

if (key === 'theme') {
  if (!isThemePreference(body.value)) {
    sendJson(res, 400, { success: false, error: 'Invalid theme preference' });
    return true;
  }
  await setSetting('theme', body.value);
  applyNativeAppearancePreference(body.value);
  sendJson(res, 200, { success: true });
  return true;
}
```

- [ ] **Step 6: Run tests and type checking**

Run: `pnpm test -- tests/unit/native-appearance.test.ts tests/unit/stores.test.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit native synchronization**

```bash
git add electron/main/appearance.ts electron/main/index.ts electron/api/routes/settings.ts tests/unit/native-appearance.test.ts
git commit -m "feat: sync native window appearance"
```

---

### Task 4: Add adaptive and fidelity preview appearance modes

**Files:**
- Modify: `src/lib/preview-srcdoc.ts`
- Modify: `src/components/file-preview/FilePreviewViewer.tsx`
- Modify: `src/components/file-preview/WordDocViewer.tsx`
- Modify: `src/components/file-preview/ExcelGridViewer.tsx`
- Modify: `tests/unit/preview-srcdoc.test.ts`

**Interfaces:**
- Consumes: `ResolvedAppearance`, `STO_APPEARANCE_MESSAGE_TYPE`, `postResolvedAppearance()`, existing base/fetch bridge behavior.
- Produces: `PreviewAppearanceMode = 'adaptive' | 'fidelity'`, `PreviewThemeOptions`, `injectSrcDocTheme(html, options)`, and `prepareInlinePreviewSrcDoc(html, options)`.

- [ ] **Step 1: Write failing srcDoc theme tests**

```ts
it('injects adaptive dark variables and table compatibility styles', () => {
  const out = preparePreviewSrcDoc(
    '<html><head></head><body><table><tr><td>28</td></tr></table></body></html>',
    sourceUrl,
    { appearance: 'dark', mode: 'adaptive' },
  );
  expect(out).toContain('data-sto-theme="dark"');
  expect(out).toContain('data-sto-preview-mode="adaptive"');
  expect(out).toContain('--sto-preview-surface:#212121');
  expect(out).toMatch(/table[\s\S]*th[\s\S]*td/);
  expect(out).toContain('sto:appearance-change');
});

it('does not add adaptive element overrides in fidelity mode', () => {
  const out = prepareInlinePreviewSrcDoc('<html><head></head><body>paper</body></html>', {
    appearance: 'dark',
    mode: 'fidelity',
  });
  expect(out).toContain('data-sto-preview-mode="fidelity"');
  expect(out).not.toContain('data-sto-preview-mode="adaptive"] table');
});
```

Retain the existing base URL, origin guard, fetch timeout, and body-content tests.

- [ ] **Step 2: Run preview tests and confirm failure**

Run: `pnpm test -- tests/unit/preview-srcdoc.test.ts`

Expected: FAIL because the theme options and injection helpers are absent.

- [ ] **Step 3: Implement the preview theme injection**

Inject an early style and script into `<head>`. The script must only accept a parent-window message with `{ type: 'sto:appearance-change', appearance: 'light' | 'dark' }`, then update `document.documentElement.dataset.stoTheme` and `style.colorScheme`.

Adaptive dark CSS must target standard generated content and use scoped, high-specificity compatibility rules:

```css
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] body {
  color: var(--sto-preview-text) !important;
  background: var(--sto-preview-surface) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] :is(table, th, td) {
  color: var(--sto-preview-text) !important;
  border-color: var(--sto-preview-border) !important;
}
html[data-sto-preview-mode="adaptive"][data-sto-theme="dark"] td {
  background: var(--sto-preview-surface-secondary) !important;
}
```

Do not inject filters, blend modes, or broad `* { background: ... !important }` rules.

- [ ] **Step 4: Wire adaptive remote HTML without reload-on-toggle**

Mark `RemoteSrcDocPreview` iframes with `data-sto-theme-sync="true"`. Use the resolved appearance for initial HTML generation, post it again in `onLoad`, and post updates in an effect. Keep `srcDoc` stable when only appearance changes so interactive preview state is not reset.

The existing `useMemo` remains justified because source HTML can be large. Read the latest appearance from a ref while keeping only document identity in the memo dependencies:

```tsx
const appearance = useResolvedAppearance();
const appearanceRef = useRef(appearance);
appearanceRef.current = appearance;
const srcDoc = useMemo(
  () => preparePreviewSrcDoc(html, sourceUrl, {
    appearance: appearanceRef.current,
    mode: 'adaptive',
  }),
  [html, sourceUrl],
);

useEffect(() => {
  const target = iframeRef.current?.contentWindow;
  if (target) postResolvedAppearance(target, appearance);
}, [appearance]);
```

Use `mode: 'adaptive'` for generated/remote artifact HTML. Keep direct cross-origin `HtmlIframeView` in fidelity mode and only set its element `style={{ colorScheme: appearance }}` because its document cannot be safely rewritten.

- [ ] **Step 5: Wire Word and file preview boundaries**

Pass Mammoth fallback HTML through `prepareInlinePreviewSrcDoc(..., { mode: 'adaptive' })` and mark its iframe for theme sync. Keep docx-preview paper sections and PPT slide canvases in fidelity mode. Replace file preview canvas-only dark hex values with `var(--sto-surface-under)` or `var(--sto-surface-secondary)` while keeping image/document content colors intact. Apply the same canvas tokens to `ExcelGridViewer`.

- [ ] **Step 6: Run focused preview verification**

Run: `pnpm test -- tests/unit/preview-srcdoc.test.ts`

Expected: PASS, including the existing fetch bridge timeout and origin tests.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit preview boundaries**

```bash
git add src/lib/preview-srcdoc.ts src/components/file-preview/FilePreviewViewer.tsx src/components/file-preview/WordDocViewer.tsx src/components/file-preview/ExcelGridViewer.tsx tests/unit/preview-srcdoc.test.ts
git commit -m "fix: adapt generated previews to dark appearance"
```

---

### Task 5: Build presentational neutral controls and migrate My Tasks plus Skill Plaza

**Files:**
- Create: `src/components/ui/sto-neutral-controls.tsx`
- Create: `tests/unit/sto-neutral-controls.test.tsx`
- Modify: `src/pages/MyTask/components/SectionTabs.tsx`
- Modify: `src/pages/MyTask/components/NewTaskDropdownButton.tsx`
- Modify: `src/pages/MyTask/components/TaskToolbar.tsx`
- Modify: `src/pages/MyTask/index.tsx`
- Modify: `src/components/skill-plaza/SkillPlazaHeader.tsx`
- Modify: `src/components/skill-plaza/SkillPlazaCategoryNav.tsx`
- Modify: `src/components/skill-plaza/SkillIcon.tsx`
- Modify: `src/components/skill-plaza/SkillCard.tsx`
- Modify: `src/components/skill-plaza/SkillPlazaPage.tsx`
- Modify: `tests/unit/skill-upload-modal.test.tsx`

**Interfaces:**
- Consumes: neutral classes from Task 1 and page-owned event handlers/state.
- Produces: `StoSearchField`, `StoOutlineButton`, `StoSegmentTabs`, `StoIconSurface`, and `stoNeutralCardClass` consumption.

- [ ] **Step 1: Write failing presentational-control tests**

```tsx
it('renders controlled search without owning debounce behavior', () => {
  const onValueChange = vi.fn();
  render(<StoSearchField value="" onValueChange={onValueChange} placeholder="搜索技能" />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pdf' } });
  expect(onValueChange).toHaveBeenCalledWith('pdf');
});

it('reports tab changes to the owning page', () => {
  const onValueChange = vi.fn();
  render(
    <StoSegmentTabs
      value="skills"
      ariaLabel="分区"
      items={[{ value: 'skills', label: '技能' }, { value: 'connectors', label: '连接器' }]}
      onValueChange={onValueChange}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: '连接器' }));
  expect(onValueChange).toHaveBeenCalledWith('connectors');
});

it('uses semantic dark surfaces and preserves explicit light classes', () => {
  render(<StoOutlineButton>上传技能</StoOutlineButton>);
  const button = screen.getByRole('button', { name: '上传技能' });
  expect(button.className).toContain('bg-white');
  expect(button.className).toContain('dark:bg-[var(--sto-control-bg)]');
});
```

- [ ] **Step 2: Run control tests and confirm failure**

Run: `pnpm test -- tests/unit/sto-neutral-controls.test.tsx`

Expected: FAIL because the neutral controls do not exist.

- [ ] **Step 3: Implement presentation-only controls**

Each component accepts content/state/callback props and owns no request, navigation, debounce, store access, or toast behavior. Use ordinary functions; do not add memoization wrappers.

`StoSegmentTabs` should be generic over a string value and render accessible `role="tablist"`/`role="tab"` markup. `StoSearchField` forwards controlled text changes. `StoOutlineButton` accepts standard button attributes. `StoIconSurface` only renders its children inside the shared surface.

```tsx
export type StoSegmentTabItem<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
};

export function StoSearchField({ value, onValueChange, placeholder, className }: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={cn(stoSearchFieldShellClass, className)}>
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function StoOutlineButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn(stoOutlineButtonBaseClass, 'h-9 px-3', className)} {...props} />;
}

export function StoSegmentTabs<T extends string>({ value, items, onValueChange, ariaLabel }: {
  value: T;
  items: Array<StoSegmentTabItem<T>>;
  onValueChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={stoSegmentTabsTrackClass} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            className={stoSegmentTabClass(value === item.value)}
            onClick={() => onValueChange(item.value)}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function StoIconSurface({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(stoIconSurfaceClass, className)} {...props} />;
}
```

- [ ] **Step 4: Migrate My Tasks without changing behavior**

Replace the hand-rendered section tab track, header search shell, create button shell, and sort trigger shell with the shared controls. Keep My Tasks URL synchronization, search state, sort-open state, click-outside behavior, creation modal callbacks, and translations in their existing page/components.

- [ ] **Step 5: Migrate Skill Plaza without changing behavior**

Replace the skill/connector segment, search field shell, folder/upload buttons, sort trigger, icon surface, and card surface. Keep the existing 300 ms search debounce in `SkillPlazaHeader`, folder IPC call, upload modal state, category counts, sorting, installation state, and routing in their existing owners.

Remove dark-mode white blocks from:

- search, folder, upload, refresh, and sort controls;
- active category pills and grid/list controls;
- `SkillIcon` fallback surface;
- skill cards and connector cards shown on the same route.

- [ ] **Step 6: Run component and existing behavior tests**

Run: `pnpm test -- tests/unit/sto-neutral-controls.test.tsx tests/unit/skill-upload-modal.test.tsx tests/unit/skill-plaza-store.test.ts tests/unit/skill-plaza-cache.test.ts`

Expected: PASS; existing upload, search, store, and cache behavior remains unchanged.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit shared controls and page migration**

```bash
git add src/components/ui/sto-neutral-controls.tsx tests/unit/sto-neutral-controls.test.tsx src/pages/MyTask/components/SectionTabs.tsx src/pages/MyTask/components/NewTaskDropdownButton.tsx src/pages/MyTask/components/TaskToolbar.tsx src/pages/MyTask/index.tsx src/components/skill-plaza/SkillPlazaHeader.tsx src/components/skill-plaza/SkillPlazaCategoryNav.tsx src/components/skill-plaza/SkillIcon.tsx src/components/skill-plaza/SkillCard.tsx src/components/skill-plaza/SkillPlazaPage.tsx tests/unit/skill-upload-modal.test.tsx
git commit -m "refactor: share neutral controls across task and skill pages"
```

---

### Task 6: Migrate high-risk dark surfaces and add a regression guard

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/tabs.tsx`
- Modify: `src/components/ui/dropdown-menu.tsx`
- Modify: `src/components/workflow/WorkflowPreviewPanel.tsx`
- Modify: `src/components/connectors/ConnectorCard.tsx`
- Modify: `src/components/skill-plaza/SkillUploadModal.tsx`
- Modify: `src/components/file-preview/SaveArtifactDialog.tsx`
- Modify: `src/components/file-preview/ArtifactShareDialog.tsx`
- Create: `tests/unit/dark-appearance-surface-guard.test.ts`

**Interfaces:**
- Consumes: semantic tokens and neutral Surface classes from Task 1.
- Produces: a curated static guard for application UI surfaces; explicit fidelity exceptions remain documented in the test.

- [ ] **Step 1: Write a failing curated surface guard**

```ts
const guardedFiles = [
  'src/components/skill-plaza/SkillPlazaHeader.tsx',
  'src/components/skill-plaza/SkillPlazaCategoryNav.tsx',
  'src/components/skill-plaza/SkillIcon.tsx',
  'src/components/workflow/WorkflowPreviewPanel.tsx',
  'src/components/connectors/ConnectorCard.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/input.tsx',
  'src/components/ui/tabs.tsx',
];

it.each(guardedFiles)('%s does not introduce unpaired light-only controls', (file) => {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  expect(source).not.toMatch(/bg-white(?![^'"\n]*dark:bg-)/);
  expect(source).not.toMatch(/text-\[#1D2129\](?![^'"\n]*dark:text-)/i);
  expect(source).not.toMatch(/hover:bg-\[#F2F3F5\](?![^'"\n]*dark:hover:bg-)/i);
});
```

If multiline Tailwind strings make the simple expression unreliable, normalize adjacent string literals in a small test-only helper. Do not weaken the check by allowing the whole file.

- [ ] **Step 2: Run the guard and record the exact failures**

Run: `pnpm test -- tests/unit/dark-appearance-surface-guard.test.ts`

Expected: FAIL on the known Skill Plaza, Workflow Preview, Connector, and shared UI hardcoded light controls.

- [ ] **Step 3: Migrate shared UI dark branches only**

Keep every current light class in `Button`, `Input`, `Tabs`, and Dropdown. Replace only dark branches such as `dark:bg-white/10`, `dark:data-[state=active]:bg-white/15`, and dark glass backgrounds with `var(--sto-control-bg)`, `var(--sto-control-hover-bg)`, `var(--sto-control-active-bg)`, and `var(--sto-surface-elevated)`.

For example, use these exact dark branches while retaining the current light branches before them:

```ts
outline: cn(
  'border border-glass-border bg-[hsl(var(--glass-bg)/0.5)] backdrop-blur-glass hover:bg-black/[0.06]',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)] dark:hover:bg-[var(--sto-control-hover-bg)]',
),
```

```tsx
className={cn(
  'inline-flex h-10 items-center justify-center rounded-md bg-white/20 border border-glass-border p-1 text-muted-foreground',
  'dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-control-bg)]',
)}
```

- [ ] **Step 4: Migrate high-risk panels and dialogs**

Replace the light-only groups in `WorkflowPreviewPanel` with semantic surface/text/border variables. Apply the same rule to Connector cards and the skill upload/file artifact dialogs: existing light declarations remain; dark declarations use semantic tokens. Status colors (success, warning, destructive, brand) remain semantic and must not be converted to neutral gray.

Use explicit paired light/dark branches so the light rendering stays unchanged:

```tsx
<div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#F7F8FA] dark:bg-[var(--sto-surface-primary)]">
  <div className="shrink-0 border-b border-[#E5E6EB] bg-white px-4 py-3 dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-secondary)]">
    <h3 className="text-[14px] font-semibold text-[#1D2129] dark:text-[var(--sto-text-primary)]">
      {detail.workflowName}
    </h3>
  </div>
</div>
```

Keep these fidelity exceptions outside the guard or explicitly exempt only the exact selector:

- `.sclaw-pptx-host .pptx-preview-wrapper` white slide canvas;
- `.sclaw-docx-host .docx-wrapper > section.docx` white paper canvas;
- image content pixels;
- code syntax colors;
- remote external iframe document colors.

- [ ] **Step 5: Run the guard and focused tests**

Run: `pnpm test -- tests/unit/dark-appearance-surface-guard.test.ts tests/unit/skill-upload-modal.test.tsx tests/unit/app-shell-surface-tokens.test.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the audited surface migration**

```bash
git add src/components/ui/button.tsx src/components/ui/input.tsx src/components/ui/tabs.tsx src/components/ui/dropdown-menu.tsx src/components/workflow/WorkflowPreviewPanel.tsx src/components/connectors/ConnectorCard.tsx src/components/skill-plaza/SkillUploadModal.tsx src/components/file-preview/SaveArtifactDialog.tsx src/components/file-preview/ArtifactShareDialog.tsx tests/unit/dark-appearance-surface-guard.test.ts
git commit -m "fix: normalize high-risk dark surfaces"
```

---

### Task 7: Run complete verification and document the appearance behavior

**Files:**
- Modify: `README.md` only if the user-visible System/theme behavior is documented there
- Inspect: `README.zh-CN.md` and `README.ja-JP.md` if present at execution time
- Inspect: all files changed in Tasks 1-6

**Interfaces:**
- Consumes: the completed appearance system.
- Produces: verified tests, lint/typecheck results, Electron visual audit results, and synchronized documentation where applicable.

- [ ] **Step 1: Verify source naming constraints**

Run:

```bash
rg -ni "codex" src/components/theme src/components/ui/sto-neutral-controls.tsx tests/unit/theme-controller.test.tsx tests/unit/dark-appearance-tokens.test.ts tests/unit/dark-appearance-surface-guard.test.ts
```

Expected: no matches. Do not broaden the scan to the unrelated Provider/OAuth integration.

- [ ] **Step 2: Run all focused unit tests**

Run:

```bash
pnpm test -- tests/unit/dark-appearance-tokens.test.ts tests/unit/theme-controller.test.tsx tests/unit/native-appearance.test.ts tests/unit/preview-srcdoc.test.ts tests/unit/sto-neutral-controls.test.tsx tests/unit/dark-appearance-surface-guard.test.ts tests/unit/app-shell-surface-tokens.test.ts tests/unit/skill-upload-modal.test.tsx
```

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run project-wide static verification**

Run: `pnpm run typecheck`

Expected: PASS.

Run: `pnpm run lint`

Expected: PASS. If the documented `temp_uv_extract` race appears, confirm no `uv:download` process is active and rerun lint once.

- [ ] **Step 4: Run the Electron app and inspect the required routes**

Run: `pnpm dev`

In the real Electron window, inspect both light and dark appearances at:

- `/` chat with Markdown table and an adaptive generated HTML table;
- `/skills` Skill Plaza and My Skills, including search, category, folder/upload, sort, icon, card, Connector section, and upload dialog;
- `/my-tasks` tabs, search, create button, sorting, cards, and empty state;
- `/workflow` plus embedded workflow preview;
- `/settings` dialogs/dropdowns;
- `/login` and `/setup` entry surfaces;
- `/more-apps` embedded content and its controlled theme fallback;
- file previews for HTML, Markdown, CSV/Excel, Word fallback, Word high-fidelity paper, PPT slide, and image.

Expected: light rendering is visually unchanged; dark controls use low-contrast neutral surfaces; generated table cells are dark and readable; fidelity paper/slides/images retain authored colors.

- [ ] **Step 5: Verify runtime theme synchronization**

With preference set to System, switch macOS appearance Light → Dark → Light while the main window, Sprite, FloatIcon, and an adaptive HTML preview are open.

Expected: all renderer documents update without restart; adaptive iframe updates without reload/state loss; transparent Sprite/FloatIcon windows remain transparent; the opaque main native background follows the resolved appearance.

- [ ] **Step 6: Review documentation**

If README already documents appearance behavior, update it to state that System follows OS changes in real time and generated HTML previews adapt while fidelity document canvases preserve source colors. At execution time, check whether `README.zh-CN.md` and `README.ja-JP.md` exist and mirror the same behavior if they do. Do not create missing translated READMEs solely for this task.

- [ ] **Step 7: Commit verification/doc changes**

If documentation changed:

```bash
git add README.md
git commit -m "docs: explain appearance synchronization"
```

If translated READMEs exist at execution time and changed, add those exact existing paths separately. If no documentation change is required, do not create an empty commit.

- [ ] **Step 8: Record final repository state**

Run: `git status --short`

Expected: no implementation changes remain unstaged; the user's existing untracked `生成/` directory may remain and must not be added.
