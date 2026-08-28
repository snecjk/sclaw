# App Dev Site / Assets Publish Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Site/Assets identity in the development workbench and present type-specific information after a shared deployment succeeds.

**Architecture:** Keep the existing create, edit, push, deploy, and polling pipelines shared. Normalize `pageType` at the code-application boundary and normalize `resourcePages` into a discriminated success-presentation model; only the terminal success UI branches into focused Site and Assets result components.

**Tech Stack:** TypeScript, React 19, Electron Main, Zustand/Renderer Host API, Vitest, Testing Library, `sai-cli policy code-application` and `sai-cli policy code-deploy`.

**Spec:** `docs/superpowers/specs/2026-08-21-app-dev-page-type-publish-result-design.md`

## Global Constraints

- `pageType` is exactly `'site' | 'assets'`; missing or unknown cloud values normalize to `'site'`.
- Creation defaults to `site` and invokes `sai-cli policy code-application create --pageType site` or `--pageType assets`.
- Creation after the cloud record exists, editing, preview, push, deploy creation, and deploy polling remain shared.
- Only terminal success presentation branches by `pageType`; running, failed, cancelled, timeout, and error presentation remain shared.
- Site success exposes only the fixed domain and never exposes an OSS artifact URL.
- Assets success exposes the deployment version and OSS artifact URL, plus a disabled/placeholder custom-domain action until that service is implemented.
- Site history, Site rollback, full custom-domain application, and App Plaza card/filter changes are out of scope.
- Do not add dependencies or change package manifests.
- Preserve unrelated working-tree changes and stage only files owned by the current task.

---

## File Structure

### Files already modified before this plan

- `src/components/more-apps/CreateAppDialog.tsx`: Site/Assets creation choice and copy.
- `src/lib/app-dev-api.ts`: Renderer create DTO includes `pageType`.
- `electron/services/app-dev-service.ts`: defaults/validates create input and forwards `pageType`.
- `electron/services/code-collab-service.ts`: creates code applications through `sai-cli`.
- `electron/services/code-application-create-command.ts`: pure CLI argument builder.
- `tests/unit/create-app-dialog.test.tsx`: creation UI behavior.
- `tests/unit/code-application-create-command.test.ts`: CLI argument behavior.

These changes were red/green tested before plan creation but remain uncommitted. Task 1 reviews and commits them as the baseline.

### Files created by this plan

- `shared/code-publish-result.ts`: pure, UI-independent normalization from `resourcePages` to Site/Assets presentation data.
- `src/components/app-dev/SitePublishSuccess.tsx`: Site-only success details.
- `src/components/app-dev/AssetsPublishSuccess.tsx`: Assets-only success details.
- `tests/unit/code-publish-result.test.ts`: resource normalization contract.
- `tests/unit/app-dev-publish-success.test.tsx`: success UI behavior and information-hiding checks.

### Files modified by this plan

- `shared/code-application-catalog.ts`: parse and normalize cloud `pageType`.
- `electron/services/app-dev-service.ts`: persist type in marker and expose it in `DevAppSummary`.
- `src/lib/app-dev-api.ts`: expose `pageType` on `DevAppSummary` and publish-related props.
- `src/hooks/use-sto-app-deploy.ts`: retain raw terminal success data in the deployment job.
- `src/components/app-dev/StoAppDeployControl.tsx`: select success result component while keeping non-success states shared.
- `src/components/more-apps/AppPlazaDevAppPane.tsx`: pass application type into the workbench header and deploy control.
- `src/pages/AppDev/AppDevWorkbench.tsx`: keep the legacy/direct workbench route consistent.
- Existing tests under `tests/unit/`: extend catalog, deploy-status, and workbench regression coverage.

---

### Task 1: Commit the Existing Creation-Type Baseline

**Files:**
- Modify: `src/components/more-apps/CreateAppDialog.tsx`
- Modify: `src/lib/app-dev-api.ts`
- Modify: `electron/services/app-dev-service.ts`
- Modify: `electron/services/code-collab-service.ts`
- Create: `electron/services/code-application-create-command.ts`
- Test: `tests/unit/create-app-dialog.test.tsx`
- Test: `tests/unit/code-application-create-command.test.ts`

**Interfaces:**
- Produces: `CodeApplicationPageType = 'site' | 'assets'` in Renderer API types.
- Produces: `buildCodeApplicationCreateArgs(input): string[]`.
- Produces: `createUserApp(input: { name: string; parentDir?: string; projectType?: string; pageType?: CodeApplicationPageType })`, defaulting omitted values to `site` in Main.

- [ ] **Step 1: Review the existing uncommitted diff against the approved creation behavior**

Confirm the diff contains these exact observable behaviors:

```ts
// Renderer request
createUserApp({
  name,
  parentDir,
  projectType: 'frontend',
  pageType: 'site' | 'assets',
});

// CLI invocation
[
  'policy', 'code-application', 'create',
  '--applicationUid', applicationUid,
  '--applicationCode', applicationCode,
  '--applicationName', applicationName,
  '--pageType', pageType,
]
```

- [ ] **Step 2: Run the focused baseline tests**

Run:

```bash
pnpm vitest run tests/unit/create-app-dialog.test.tsx tests/unit/code-application-create-command.test.ts
```

Expected: 2 test files and 4 tests PASS.

- [ ] **Step 3: Run whitespace and focused lint checks**

Run:

```bash
git diff --check
pnpm exec eslint electron/services/code-application-create-command.ts tests/unit/create-app-dialog.test.tsx tests/unit/code-application-create-command.test.ts
```

Expected: exit 0. Do not broaden this step to pre-existing repository lint failures.

- [ ] **Step 4: Commit only the creation baseline**

```bash
git add src/components/more-apps/CreateAppDialog.tsx src/lib/app-dev-api.ts electron/services/app-dev-service.ts electron/services/code-collab-service.ts electron/services/code-application-create-command.ts tests/unit/create-app-dialog.test.tsx tests/unit/code-application-create-command.test.ts
git commit -m "feat: select code application page type"
```

---

### Task 2: Normalize and Propagate Cloud Application Type

**Files:**
- Modify: `shared/code-application-catalog.ts`
- Modify: `electron/services/app-dev-service.ts`
- Modify: `src/lib/app-dev-api.ts`
- Test: `tests/unit/code-application-catalog.test.ts`

**Interfaces:**
- Produces: `export type CodeApplicationPageType = 'site' | 'assets'` from `shared/code-application-catalog.ts`.
- Produces: `normalizeCodeApplicationPageType(value: unknown): CodeApplicationPageType`.
- Produces: required `pageType` on normalized `CodeApplicationRecord` and `DevAppSummary`.
- Consumes: cloud list/detail payload and local `.sclaw/app-dev.json` fallback.

- [ ] **Step 1: Write failing catalog normalization tests**

Create or extend `tests/unit/code-application-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeCodeApplication,
  normalizeCodeApplicationPageType,
} from '../../shared/code-application-catalog';

describe('code application pageType', () => {
  it.each([
    ['site', 'site'],
    ['assets', 'assets'],
    [undefined, 'site'],
    ['unknown', 'site'],
  ])('normalizes %j to %s', (raw, expected) => {
    expect(normalizeCodeApplicationPageType(raw)).toBe(expected);
  });

  it('keeps pageType from a cloud application record', () => {
    expect(normalizeCodeApplication({
      applicationId: 'app-assets',
      applicationName: 'Assets App',
      pageType: 'assets',
    })).toMatchObject({ pageType: 'assets' });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/code-application-catalog.test.ts
```

Expected: FAIL because the page-type export/property does not exist.

- [ ] **Step 3: Implement the shared type and parser**

Add to `shared/code-application-catalog.ts`:

```ts
export type CodeApplicationPageType = 'site' | 'assets';

export function normalizeCodeApplicationPageType(value: unknown): CodeApplicationPageType {
  return typeof value === 'string' && value.trim().toLowerCase() === 'assets'
    ? 'assets'
    : 'site';
}
```

Add `pageType: CodeApplicationPageType` to `CodeApplicationRecord` and set it in `normalizeCodeApplication` from `row.pageType`.

In `electron/services/app-dev-service.ts`:

- add optional `pageType` to `AppDevMarker` for offline/local fallback;
- write the selected type during creation;
- include `pageType` in `DevAppSummary`;
- resolve summary type as `cloud.pageType`, then marker value, then `site`;
- when refreshing an existing local app, update the marker cache from the cloud value without changing other marker fields.

In `src/lib/app-dev-api.ts`, remove the Task 1 Renderer-local duplicate type, import the shared type, and add required `pageType` to Renderer `DevAppSummary`.

- [ ] **Step 4: Run the catalog test and affected app tests**

Run:

```bash
pnpm vitest run tests/unit/code-application-catalog.test.ts tests/unit/create-app-dialog.test.tsx tests/unit/more-apps-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the application type propagation**

```bash
git add shared/code-application-catalog.ts electron/services/app-dev-service.ts src/lib/app-dev-api.ts tests/unit/code-application-catalog.test.ts
git commit -m "feat: propagate code application page type"
```

---

### Task 3: Normalize Publish Success Resources

**Files:**
- Create: `shared/code-publish-result.ts`
- Test: `tests/unit/code-publish-result.test.ts`
- Modify: `shared/code-deploy-status.ts`
- Test: `tests/unit/code-deploy-status.test.ts`

**Interfaces:**
- Consumes: `pageType`, `deploymentVersion`, `revisionId`, and unknown `resourcePages` from code-deploy create/refresh records.
- Produces:

```ts
export type PublishSuccessPresentation =
  | { pageType: 'site'; fixedUrl?: string }
  | { pageType: 'assets'; version?: string; artifactUrl?: string; customDomain?: string };

export function resolvePublishSuccessPresentation(input: {
  pageType: CodeApplicationPageType;
  deploymentVersion?: string;
  revisionId?: string;
  resourcePages?: unknown;
}): PublishSuccessPresentation;
```

- [ ] **Step 1: Write failing resource normalization tests**

Create `tests/unit/code-publish-result.test.ts` with literal service-shaped fixtures:

```ts
import { describe, expect, it } from 'vitest';
import { resolvePublishSuccessPresentation } from '../../shared/code-publish-result';

describe('resolvePublishSuccessPresentation', () => {
  it('returns only the fixed URL for a site', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'site',
      resourcePages: [{ url: 'https://fixed.example.cn', artifactUrl: 'https://oss.example.cn/site.zip' }],
    })).toEqual({ pageType: 'site', fixedUrl: 'https://fixed.example.cn' });
  });

  it('returns version and OSS artifact for assets', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'assets',
      deploymentVersion: '1.4.0',
      resourcePages: [{ artifactUrl: 'https://oss.example.cn/assets/1.4.0/index.js' }],
    })).toEqual({
      pageType: 'assets',
      version: '1.4.0',
      artifactUrl: 'https://oss.example.cn/assets/1.4.0/index.js',
    });
  });

  it('accepts a direct resource URL string', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'assets',
      revisionId: 'rev-12',
      resourcePages: 'https://oss.example.cn/assets/rev-12/',
    })).toEqual({
      pageType: 'assets',
      version: 'rev-12',
      artifactUrl: 'https://oss.example.cn/assets/rev-12/',
    });
  });

  it('does not reinterpret an OSS URL as a site fixed URL', () => {
    expect(resolvePublishSuccessPresentation({
      pageType: 'site',
      resourcePages: [{ artifactUrl: 'https://oss.example.cn/private/site.zip' }],
    })).toEqual({ pageType: 'site', fixedUrl: undefined });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/code-publish-result.test.ts
```

Expected: FAIL because `shared/code-publish-result.ts` does not exist.

- [ ] **Step 3: Implement the pure normalizer**

In `shared/code-publish-result.ts`, implement these exact extraction rules:

1. Treat `resourcePages` as zero or more records: a string becomes `{ url: string }`, an object becomes one record, and an array keeps object/string entries.
2. A URL is accepted only when it is a trimmed `http://` or `https://` string.
3. Site fixed URL keys, in order: `fixedUrl`, `pageUrl`, `previewUrl`, `url`, `domain`.
4. Assets artifact URL keys, in order: `artifactUrl`, `ossUrl`, `resourceUrl`, `downloadUrl`, `url`.
5. Assets version keys, in order: explicit `deploymentVersion`, record `version`, record `deploymentVersion`, explicit `revisionId`.
6. Custom-domain keys, in order: `customDomain`, `domain`.
7. Never read artifact-only keys when resolving a Site fixed URL.

Use small private helpers `asHttpUrl`, `resourceRecords`, and `pickRecordString`; do not import React or Electron.

- [ ] **Step 4: Preserve deployment version/revision in deploy fields**

Extend `CodeDeployRecordFields` in `shared/code-deploy-status.ts`:

```ts
deploymentVersion?: string;
revisionId?: string;
```

Update `pickCodeDeployFields` to read `deploymentVersion`, falling back to `version`, and to read `revisionId`. Add assertions to `tests/unit/code-deploy-status.test.ts` using a nested CLI envelope.

- [ ] **Step 5: Run both normalization test files**

Run:

```bash
pnpm vitest run tests/unit/code-publish-result.test.ts tests/unit/code-deploy-status.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the publish result model**

```bash
git add shared/code-publish-result.ts shared/code-deploy-status.ts tests/unit/code-publish-result.test.ts tests/unit/code-deploy-status.test.ts
git commit -m "feat: normalize application publish resources"
```

---

### Task 4: Retain Terminal Success Data in the Shared Deploy Job

**Files:**
- Modify: `src/hooks/use-sto-app-deploy.ts`
- Test: `tests/unit/use-sto-app-deploy.test.tsx`
- Modify: `src/lib/sto-app-deploy-flow.ts`
- Test: `tests/unit/sto-app-deploy-flow.test.ts`

**Interfaces:**
- Produces: `StoAppDeployJob.data?: unknown`, populated for terminal outcomes.
- Preserves: `start({ env, deploymentVersion })` and the shared deploy request/polling flow.

- [ ] **Step 1: Write a failing Hook test for success-data retention**

In `tests/unit/use-sto-app-deploy.test.tsx`, mock only `runStoAppDeployFlow` and render a small test harness that exposes `job`. Resolve the flow with:

```ts
{
  kind: 'success',
  fields: {
    deploymentId: 'dep-1',
    status: 'SUCCESS',
    resourcePages: [{ artifactUrl: 'https://oss.example.cn/a.js' }],
  },
  data: { deploymentId: 'dep-1', status: 'SUCCESS' },
}
```

Assert the final job contains both `fields.resourcePages` and `data`.

- [ ] **Step 2: Run the Hook test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/use-sto-app-deploy.test.tsx
```

Expected: FAIL because `StoAppDeployJob` does not retain `data`.

- [ ] **Step 3: Add terminal data to the shared job**

Add `data?: unknown` to `StoAppDeployJob`. Set `data: outcome.data` for success, failed, and timeout. Leave pushing/creating/polling jobs without `data`.

Do not add `pageType` to `runStoAppDeployFlow` and do not branch inside the Hook.

- [ ] **Step 4: Add a flow regression test proving requests remain shared**

In `tests/unit/sto-app-deploy-flow.test.ts`, assert `runStoAppDeployFlow` calls `deployStoApp` with exactly the existing parameters and no `pageType` property:

```ts
expect(deployStoAppMock).toHaveBeenCalledWith({
  workspaceId: 'ws-1',
  env: 'daily',
  applicationId: 'app-1',
  deploymentVersion: '1.4.0',
  pushMessage: '发布前同步: Demo (daily)',
});
```

- [ ] **Step 5: Run the Hook and flow tests**

Run:

```bash
pnpm vitest run tests/unit/use-sto-app-deploy.test.tsx tests/unit/sto-app-deploy-flow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared deploy-job retention**

```bash
git add src/hooks/use-sto-app-deploy.ts src/lib/sto-app-deploy-flow.ts tests/unit/use-sto-app-deploy.test.tsx tests/unit/sto-app-deploy-flow.test.ts
git commit -m "feat: retain deployment success resources"
```

---

### Task 5: Build Type-Specific Success Components

**Files:**
- Create: `src/components/app-dev/SitePublishSuccess.tsx`
- Create: `src/components/app-dev/AssetsPublishSuccess.tsx`
- Test: `tests/unit/app-dev-publish-success.test.tsx`

**Interfaces:**
- Consumes Site props: `{ fixedUrl?: string; onCopy: (value: string) => void; onOpen: (value: string) => void }`.
- Consumes Assets props: `{ version?: string; artifactUrl?: string; customDomain?: string; onCopy: (value: string) => void }`.
- Produces accessible labels used by the deploy control.

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/app-dev-publish-success.test.tsx`:

```tsx
it('shows a Site fixed domain without exposing an OSS URL', () => {
  render(<SitePublishSuccess
    fixedUrl="https://demo.example.cn"
    onCopy={vi.fn()}
    onOpen={vi.fn()}
  />);
  expect(screen.getByText('https://demo.example.cn')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '访问站点' })).toBeInTheDocument();
  expect(screen.queryByText(/OSS 产物/)).not.toBeInTheDocument();
});

it('shows an Assets version and artifact URL', () => {
  render(<AssetsPublishSuccess
    version="1.4.0"
    artifactUrl="https://oss.example.cn/assets/1.4.0/index.js"
    onCopy={vi.fn()}
  />);
  expect(screen.getByText('1.4.0')).toBeInTheDocument();
  expect(screen.getByText('https://oss.example.cn/assets/1.4.0/index.js')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制产物地址' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '申请自定义域名' })).toBeDisabled();
});
```

Add one missing-data test per component. Expected copy:

- Site: `发布成功，访问地址暂未返回`
- Assets: `发布成功，产物信息暂未返回`

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/app-dev-publish-success.test.tsx
```

Expected: FAIL because both components do not exist.

- [ ] **Step 3: Implement `SitePublishSuccess`**

Render a compact `<dl>` row labeled `固定域名`. When `fixedUrl` exists, render “复制地址” and “访问站点”; when absent, render the exact missing-data copy. Do not accept an artifact URL prop.

- [ ] **Step 4: Implement `AssetsPublishSuccess`**

Render rows labeled `发布版本`, `OSS 产物`, and optional `自定义域名`. Enable “复制产物地址” only when `artifactUrl` exists. Render a disabled “申请自定义域名” button with title `自定义域名申请即将开放`.

- [ ] **Step 5: Run the success component tests**

Run:

```bash
pnpm vitest run tests/unit/app-dev-publish-success.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the success components**

```bash
git add src/components/app-dev/SitePublishSuccess.tsx src/components/app-dev/AssetsPublishSuccess.tsx tests/unit/app-dev-publish-success.test.tsx
git commit -m "feat: add typed publish success views"
```

---

### Task 6: Integrate Success Presentation into the Shared Deploy Control

**Files:**
- Modify: `src/components/app-dev/StoAppDeployControl.tsx`
- Modify: `tests/unit/app-dev-publish-success.test.tsx`

**Interfaces:**
- Consumes: `pageType: CodeApplicationPageType` prop and `StoAppDeployJob`.
- Consumes: `resolvePublishSuccessPresentation(...)` from Task 3.
- Preserves: one control for all running/failure/timeout states.

- [ ] **Step 1: Write failing deploy-control integration tests**

Extend `tests/unit/app-dev-publish-success.test.tsx` to render `StoAppDeployControl` with a success job.

For Site, pass `pageType="site"` and `resourcePages` containing both `url` and `artifactUrl`; click “发布成功” and assert the fixed URL is present while the artifact URL is absent.

For Assets, pass `pageType="assets"`, `deploymentVersion="1.4.0"`, and an artifact URL; click “发布成功” and assert version and artifact URL are present.

For a failed job, render both types in separate tests and assert both show the same `失败原因` row and “填入 AI 会话” action.

- [ ] **Step 2: Run the integration tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/app-dev-publish-success.test.tsx
```

Expected: FAIL because `StoAppDeployControl` has no `pageType` prop and no typed success section.

- [ ] **Step 3: Add the type prop and success branch**

Update props:

```ts
interface StoAppDeployControlProps {
  pageType: CodeApplicationPageType;
  // existing props unchanged
}
```

When `job.phase === 'success'`, call:

```ts
const presentation = resolvePublishSuccessPresentation({
  pageType,
  deploymentVersion: job.fields.deploymentVersion,
  revisionId: job.fields.revisionId,
  resourcePages: job.fields.resourcePages,
});
```

Render `SitePublishSuccess` or `AssetsPublishSuccess` below the shared status rows. Use `navigator.clipboard.writeText` for copy and the existing safe external-open utility for Site access. Catch clipboard/open failures and surface them with `toast.error`; never throw from the click handler.

- [ ] **Step 4: Run success and existing deploy-control tests**

Run:

```bash
pnpm vitest run tests/unit/app-dev-publish-success.test.tsx tests/unit/code-deploy-status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit deploy-control integration**

```bash
git add src/components/app-dev/StoAppDeployControl.tsx tests/unit/app-dev-publish-success.test.tsx
git commit -m "feat: present publish results by application type"
```

---

### Task 7: Show Type Identity and Wire Both Workbench Entrypoints

**Files:**
- Modify: `src/components/more-apps/AppPlazaDevAppPane.tsx`
- Modify: `src/pages/AppDev/AppDevWorkbench.tsx`
- Test: `tests/unit/app-dev-workbench-page-type.test.tsx`

**Interfaces:**
- Consumes: `DevAppSummary.pageType` from the app-dev catalog.
- Passes: required `pageType` to `StoAppDeployControl`.
- Produces: a visible `Site` or `Assets` badge beside the application title.

- [ ] **Step 1: Write failing workbench identity tests**

Create `tests/unit/app-dev-workbench-page-type.test.tsx` with focused mocks for chat/runtime dependencies. Render each workbench entrypoint with catalog data:

```ts
{
  workspaceId: 'ws-assets',
  name: '资源应用',
  appPath: '/tmp/SClawApps/资源应用',
  projectType: 'frontend',
  createdAt: '2026-08-21T00:00:00.000Z',
  localReady: true,
  availability: 'local',
  applicationId: 'app-assets',
  pageType: 'assets',
}
```

Assert an element with accessible label `应用类型：Assets` exists. Repeat with `site` and label `应用类型：Site`. Add a loading case where no matching summary exists and assert neither type badge is rendered.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/app-dev-workbench-page-type.test.tsx
```

Expected: FAIL because neither workbench renders a page-type badge.

- [ ] **Step 3: Resolve page type from catalog data**

In both workbench entrypoints, read the matching `DevAppSummary` from `useAppDevCatalogStore`. Do not infer the type from `projectType`, application name, URL, or deployment response.

Until the matching summary loads, omit the badge and pass `'site'` to the deploy control only as the backward-compatible execution fallback; do not visibly render a Site badge during loading.

- [ ] **Step 4: Render the badge and pass the type to deploy control**

Use the same compact badge markup in both entrypoints:

```tsx
<span aria-label={`应用类型：${pageType === 'assets' ? 'Assets' : 'Site'}`}>
  {pageType === 'assets' ? 'Assets' : 'Site'}
</span>
```

Keep it beside the application name in the workbench header. Pass `pageType={pageType ?? 'site'}` to `StoAppDeployControl`.

- [ ] **Step 5: Run workbench and deploy result tests**

Run:

```bash
pnpm vitest run tests/unit/app-dev-workbench-page-type.test.tsx tests/unit/app-dev-publish-success.test.tsx tests/unit/more-apps-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit workbench wiring**

```bash
git add src/components/more-apps/AppPlazaDevAppPane.tsx src/pages/AppDev/AppDevWorkbench.tsx tests/unit/app-dev-workbench-page-type.test.tsx
git commit -m "feat: identify application type in workbench"
```

---

### Task 8: Final Regression and Documentation Check

**Files:**
- Verify: all files from Tasks 1–7
- Modify only if verification exposes a defect in scoped code

**Interfaces:**
- Verifies the complete create → shared deploy → typed success-result contract.

- [ ] **Step 1: Run the complete focused test suite**

```bash
pnpm vitest run \
  tests/unit/create-app-dialog.test.tsx \
  tests/unit/code-application-create-command.test.ts \
  tests/unit/code-application-catalog.test.ts \
  tests/unit/code-publish-result.test.ts \
  tests/unit/code-deploy-status.test.ts \
  tests/unit/use-sto-app-deploy.test.tsx \
  tests/unit/sto-app-deploy-flow.test.ts \
  tests/unit/app-dev-publish-success.test.tsx \
  tests/unit/app-dev-workbench-page-type.test.tsx \
  tests/unit/more-apps-page.test.tsx
```

Expected: all listed test files PASS with zero failed tests.

- [ ] **Step 2: Run focused lint and whitespace checks**

```bash
pnpm exec eslint \
  shared/code-application-catalog.ts \
  shared/code-publish-result.ts \
  shared/code-deploy-status.ts \
  electron/services/code-application-create-command.ts \
  src/hooks/use-sto-app-deploy.ts \
  src/lib/sto-app-deploy-flow.ts \
  src/components/app-dev/SitePublishSuccess.tsx \
  src/components/app-dev/AssetsPublishSuccess.tsx \
  src/components/app-dev/StoAppDeployControl.tsx \
  tests/unit/code-publish-result.test.ts \
  tests/unit/app-dev-publish-success.test.tsx
git diff --check
```

Expected: exit 0. Existing unrelated repository-wide lint errors do not authorize unrelated cleanup.

- [ ] **Step 3: Run the project typecheck and record baseline failures separately**

```bash
pnpm typecheck
```

Expected target: exit 0. If it fails, compare errors against the pre-plan baseline recorded on 2026-08-21 (Monaco implicit-any/type errors, stale `dist-electron/shared/*.d.ts` TS6305 errors, existing SVG and unused-variable errors). Fix only new errors attributable to files in this plan; report unchanged baseline errors explicitly.

- [ ] **Step 4: Verify requirements by behavior**

Confirm from passing tests:

- create defaults to Site and can submit Assets;
- CLI receives `--pageType`;
- workbench shows the cloud-resolved type;
- both types use the same deploy request and polling flow;
- Site success hides OSS information;
- Assets success shows version and OSS information;
- non-success states remain shared;
- missing resource data keeps the success state and shows recovery copy.

- [ ] **Step 5: Commit any verification-only scoped fixes**

If Step 1–3 required scoped fixes:

```bash
git add \
  shared/code-application-catalog.ts \
  shared/code-publish-result.ts \
  shared/code-deploy-status.ts \
  electron/services/app-dev-service.ts \
  src/lib/app-dev-api.ts \
  src/hooks/use-sto-app-deploy.ts \
  src/lib/sto-app-deploy-flow.ts \
  src/components/app-dev/SitePublishSuccess.tsx \
  src/components/app-dev/AssetsPublishSuccess.tsx \
  src/components/app-dev/StoAppDeployControl.tsx \
  src/components/more-apps/AppPlazaDevAppPane.tsx \
  src/pages/AppDev/AppDevWorkbench.tsx \
  tests/unit/code-application-catalog.test.ts \
  tests/unit/code-publish-result.test.ts \
  tests/unit/code-deploy-status.test.ts \
  tests/unit/use-sto-app-deploy.test.tsx \
  tests/unit/sto-app-deploy-flow.test.ts \
  tests/unit/app-dev-publish-success.test.tsx \
  tests/unit/app-dev-workbench-page-type.test.tsx
git commit -m "test: verify typed application publish results"
```

If no scoped fixes were needed, do not create an empty commit.
