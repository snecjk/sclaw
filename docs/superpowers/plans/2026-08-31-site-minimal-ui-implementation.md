# Site Minimal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a clean, themed Site application skeleton that contains no fictional business data or authentication implementation copy.

**Architecture:** Add one theme entry point that supplies both CSS custom properties and Ant Design tokens. Refactor the current single layout into focused shell and page primitive components; keep routing small, make the homepage an empty application starter, and isolate component examples from the default user journey.

**Tech Stack:** React 19, TypeScript, Ant Design 5, React Router 7, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-site-minimal-ui-design.md`

## Global Constraints

- Change only `resources/app-templates/site-minimal` and tests that explicitly verify its generated resources.
- Do not alter SSO bootstrap, external-service runtime, request handling, publishing behavior, or Assets templates.
- Do not add fictional orders, KPIs, tasks, reports, profile pages, system settings, or authentication/token implementation text.
- Use semantic CSS custom properties or Ant Design tokens; do not introduce raw color literals into page components.
- Default body text is `14px` with line height at least `1.5`; keyboard focus remains visible.
- Keep the default navigation limited to Home and an explicitly marked Development Example entry.
- Preserve the existing public template placeholders `__APP_NAME__` and `__APP_TITLE__`.

---

### Task 1: Establish the Site template theme entry point

**Files:**
- Create: `resources/app-templates/site-minimal/src/theme/tokens.ts`
- Create: `resources/app-templates/site-minimal/src/theme/theme.css`
- Create: `resources/app-templates/site-minimal/src/theme/antd-theme.ts`
- Modify: `resources/app-templates/site-minimal/src/main.tsx`
- Modify: `resources/app-templates/site-minimal/src/App.tsx`
- Modify: `resources/app-templates/site-minimal/src/index.css`
- Test: `tests/unit/builtin-app-template-resources.test.ts`

**Interfaces:**
- Produces `stoAntdTheme`, an Ant Design `ThemeConfig` consumed by `App.tsx`.
- Produces globally imported semantic CSS properties beginning with `--sto-`.

- [ ] **Step 1: Write the failing resource test**

Add a test using the existing `resources` constant and `readFileSync` helper. It must assert that the following files exist and contain their public contract:

```ts
const siteRoot = join(resources, 'site-minimal');
expect(readFileSync(join(siteRoot, 'src/theme/tokens.ts'), 'utf8'))
  .toContain('export const STO_THEME_TOKENS');
expect(readFileSync(join(siteRoot, 'src/theme/antd-theme.ts'), 'utf8'))
  .toContain('export const stoAntdTheme');
expect(readFileSync(join(siteRoot, 'src/theme/theme.css'), 'utf8'))
  .toContain('--sto-color-primary');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: FAIL because the three `src/theme/*` files do not exist in the template archive.

- [ ] **Step 3: Add the theme source files**

Create `tokens.ts` with named semantic values rather than component-level colors:

```ts
export const STO_THEME_TOKENS = {
  colorBrand: '#F76F00',
  colorPrimaryAction: '#C65300',
  colorText: '#333333',
  colorTextHeading: '#1A1A1A',
  colorBgLayout: '#FAFAFA',
  colorBgContainer: '#FFFFFF',
  colorBorder: '#E8E8E8',
  fontSize: 14,
  borderRadius: 4,
  controlHeight: 32,
} as const;
```

Create `antd-theme.ts` exporting `stoAntdTheme` with `colorPrimary`, `colorSuccess`, `colorInfo`, `colorWarning`, `colorError`, text/background/border tokens, `fontSize`, `borderRadius`, and `controlHeight`. Create `theme.css` with the same semantic values as `--sto-*` custom properties, including focus outline, spacing scale, border and shadow variables.

Import `theme.css` in `main.tsx`; replace the inline `ConfigProvider` theme in `App.tsx` with `stoAntdTheme`; reduce `index.css` to global reset and font-family rules that reference the new variables.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: PASS with the archive containing all theme files.

- [ ] **Step 5: Run template typecheck and build**

Run from `resources/app-templates/site-minimal`:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add resources/app-templates/site-minimal/src/theme \
  resources/app-templates/site-minimal/src/main.tsx \
  resources/app-templates/site-minimal/src/App.tsx \
  resources/app-templates/site-minimal/src/index.css \
  tests/unit/builtin-app-template-resources.test.ts
git commit -m "feat: add site template theme system"
```

### Task 2: Split the application shell and simplify navigation

**Files:**
- Create: `resources/app-templates/site-minimal/src/layouts/AppHeader.tsx`
- Create: `resources/app-templates/site-minimal/src/layouts/AppSider.tsx`
- Create: `resources/app-templates/site-minimal/src/layouts/PageContainer.tsx`
- Modify: `resources/app-templates/site-minimal/src/layouts/AppLayout.tsx`
- Modify: `resources/app-templates/site-minimal/src/layouts/nav-config.ts`
- Modify: `resources/app-templates/site-minimal/src/index.css`
- Test: `tests/unit/builtin-app-template-resources.test.ts`

**Interfaces:**
- `AppHeader` reads the authenticated user and exposes only a valid logout action.
- `AppSider` accepts `items: SideNavItem[]`, `selectedKey: string`, and `onNavigate(path: string): void`.
- `PageContainer` accepts `children: ReactNode` and wraps ordinary route content.
- `nav-config.ts` exports `DEFAULT_PATH`, `SIDE_NAV`, `toRoutePath`, and `pathFromLocation`.

- [ ] **Step 1: Write the failing resource test**

Assert that the generated template contains the three shell files and that default navigation does not include prohibited fictional labels:

```ts
const siteRoot = join(resources, 'site-minimal');
expect(readFileSync(join(siteRoot, 'src/layouts/AppHeader.tsx'), 'utf8'))
  .toContain('export function AppHeader');
expect(readFileSync(join(siteRoot, 'src/layouts/AppSider.tsx'), 'utf8'))
  .toContain('export function AppSider');
expect(readFileSync(join(siteRoot, 'src/layouts/PageContainer.tsx'), 'utf8'))
  .toContain('export function PageContainer');
const nav = readFileSync(join(siteRoot, 'src/layouts/nav-config.ts'), 'utf8');
expect(nav).not.toContain('业务办理');
expect(nav).not.toContain('系统设置');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: FAIL because the shell is still a monolithic `AppLayout` and uses `TOP_NAV`.

- [ ] **Step 3: Implement the shell split**

Make `SIDE_NAV` contain only:

```ts
export const SIDE_NAV = [
  { key: 'home', label: '首页', path: 'home' },
  { key: 'example', label: '开发示例', path: 'example', developerOnly: true },
] as const;
```

`AppLayout` resolves the active item, renders `AppHeader`, `AppSider`, `PageContainer`, and `<Outlet />`. `AppHeader` contains the app mark/title and user avatar/dropdown; the dropdown contains only `退出登录`. `AppSider` renders a single inline menu. Give the Header, Sider and Content semantic class names and move their visual values into theme CSS variables.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Run template typecheck and build**

Run from `resources/app-templates/site-minimal`:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add resources/app-templates/site-minimal/src/layouts \
  resources/app-templates/site-minimal/src/index.css \
  tests/unit/builtin-app-template-resources.test.ts
git commit -m "refactor: simplify site template shell"
```

### Task 3: Add reusable page primitives and replace the homepage

**Files:**
- Create: `resources/app-templates/site-minimal/src/components/PageHeader.tsx`
- Create: `resources/app-templates/site-minimal/src/components/EmptyState.tsx`
- Create: `resources/app-templates/site-minimal/src/components/ContentSection.tsx`
- Modify: `resources/app-templates/site-minimal/src/pages/HomePage.tsx`
- Modify: `resources/app-templates/site-minimal/src/pages/PlaceholderPage.tsx`
- Modify: `resources/app-templates/site-minimal/src/index.css`
- Test: `tests/unit/builtin-app-template-resources.test.ts`

**Interfaces:**
- `PageHeader` accepts `{ title: string; description?: string; extra?: ReactNode; breadcrumbs?: BreadcrumbItemType[] }`.
- `ContentSection` accepts `{ title?: string; extra?: ReactNode; children: ReactNode }`.
- `EmptyState` accepts `{ title?: string; description?: string; action?: ReactNode }`.

- [ ] **Step 1: Write the failing resource test**

Assert page primitives exist, and assert that `HomePage.tsx` no longer contains fictional metric labels or protocol language:

```ts
const siteRoot = join(resources, 'site-minimal');
expect(readFileSync(join(siteRoot, 'src/components/PageHeader.tsx'), 'utf8'))
  .toContain('export function PageHeader');
expect(readFileSync(join(siteRoot, 'src/components/EmptyState.tsx'), 'utf8'))
  .toContain('export function EmptyState');
const home = readFileSync(join(siteRoot, 'src/pages/HomePage.tsx'), 'utf8');
expect(home).not.toMatch(/今日待办|进行中任务|本周完成|stoToken|SSO Auth/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: FAIL because `HomePage` currently renders three fictional statistics and SSO status text.

- [ ] **Step 3: Implement page primitives and clean homepage copy**

Render `/home` as:

```tsx
<PageHeader
  breadcrumbs={[{ title: '首页' }]}
  title="__APP_TITLE__"
  description="从这里开始构建你的业务页面。"
/>
<ContentSection>
  <EmptyState
    title="应用骨架已就绪"
    description="你可以根据实际业务添加列表、表单、详情或数据看板。"
  />
</ContentSection>
```

Convert `PlaceholderPage` to use `PageHeader` and `EmptyState`; do not use `Card` directly for page layout. Implement classes with semantic background, border, radius, spacing and focus tokens.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Run template typecheck and build**

Run from `resources/app-templates/site-minimal`:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add resources/app-templates/site-minimal/src/components \
  resources/app-templates/site-minimal/src/pages \
  resources/app-templates/site-minimal/src/index.css \
  tests/unit/builtin-app-template-resources.test.ts
git commit -m "feat: add clean site template page primitives"
```

### Task 4: Isolate the development example and remove fake request behavior

**Files:**
- Modify: `resources/app-templates/site-minimal/src/pages/DemoPage.tsx`
- Modify: `resources/app-templates/site-minimal/src/App.tsx`
- Modify: `resources/app-templates/site-minimal/src/layouts/nav-config.ts`
- Test: `tests/unit/builtin-app-template-resources.test.ts`

**Interfaces:**
- Route path `example` resolves to `DemoPage`.
- `DemoPage` is a static visual reference and does not call `http`, `RequestError`, `message`, or `/api/health`.

- [ ] **Step 1: Write the failing resource test**

```ts
const siteRoot = join(resources, 'site-minimal');
expect(readFileSync(join(siteRoot, 'src/App.tsx'), 'utf8')).toContain('path="example"');
const example = readFileSync(join(siteRoot, 'src/pages/DemoPage.tsx'), 'utf8');
expect(example).not.toContain('/api/health');
expect(example).not.toContain('RequestError');
expect(example).not.toContain('华东网点巡检');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: FAIL because the route is named `demo` and it probes `/api/health` with fictional rows.

- [ ] **Step 3: Replace the example implementation**

Rename the route to `example`. Keep only generic UI examples using placeholders such as “示例标题”、“示例状态” and “示例内容”; use `PageHeader` and `ContentSection`. Do not import request utilities or generate toast messages. The default route stays `/home`; `开发示例` remains visually marked as a developer reference.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/unit/builtin-app-template-resources.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Run template typecheck and build**

Run from `resources/app-templates/site-minimal`:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add resources/app-templates/site-minimal/src/pages/DemoPage.tsx \
  resources/app-templates/site-minimal/src/App.tsx \
  resources/app-templates/site-minimal/src/layouts/nav-config.ts \
  tests/unit/builtin-app-template-resources.test.ts
git commit -m "refactor: isolate site template development example"
```

### Task 5: Validate archive output and regressions

**Files:**
- Modify: `tests/unit/builtin-app-template-resources.test.ts`
- Test: `tests/unit/builtin-app-template-resources.test.ts`
- Test: `tests/unit/site-minimal-sso-auth-contract.test.ts`
- Test: `tests/unit/app-template-contract.test.ts`

**Interfaces:**
- Generated archive must include all theme, layout and page primitive source files.
- Existing Site SSO contract remains intact.

- [ ] **Step 1: Extend archive contract coverage**

Add assertions that the archive includes `src/theme/theme.css`, `src/layouts/AppHeader.tsx`, `src/layouts/AppSider.tsx`, `src/layouts/PageContainer.tsx`, `src/components/PageHeader.tsx`, `src/components/ContentSection.tsx`, and `src/components/EmptyState.tsx`.

- [ ] **Step 2: Run archive and SSO contract tests**

Run:

```bash
npm test -- tests/unit/builtin-app-template-resources.test.ts \
  tests/unit/site-minimal-sso-auth-contract.test.ts \
  tests/unit/app-template-contract.test.ts --run
```

Expected: PASS.

- [ ] **Step 3: Run whole-repository checks relevant to the template**

Run:

```bash
npm test -- tests/unit/builtin-app-template-resources.test.ts \
  tests/unit/site-minimal-sso-auth-contract.test.ts \
  tests/unit/app-template-contract.test.ts --run
git diff --check
```

Expected: all tests pass and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/builtin-app-template-resources.test.ts
git commit -m "test: cover clean site template skeleton"
```

## Plan self-review

- Spec coverage: Tasks 1–4 respectively implement theme, shell, page primitives, and clean initial routes; Task 5 validates archive and SSO compatibility.
- Non-goals: no task modifies external services, request code, auth flow, assets template or publishing.
- Placeholder scan: no open implementation placeholders; unresolved brand-color choice is intentionally represented as the documented `#F76F00` candidate and its accessible action variant.
- Interface consistency: the exported theme and component names used in later tasks are defined in their producer tasks.
