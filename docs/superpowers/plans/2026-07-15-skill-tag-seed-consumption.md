# Skill Tag Seed Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill-plaza composer Tag a true one-shot URL seed so deleting it and switching to a new conversation cannot recreate it.

**Architecture:** `Home` derives the skill seed from the live query string instead of retaining it for the full page lifetime. The editor treats removal of the seed prop as consumption and keeps the current DOM token, while a newly mounted editor receives no consumed seed.

**Tech Stack:** React 19, React Router, TypeScript, Vitest, Testing Library.

## Global Constraints

- Do not modify dependencies, lockfiles, build scripts, or build configuration.
- Do not change skill sending, message rendering, `?q=`, or `?workflowId=` behavior.
- Follow `docs/sto-design.md`; this fix does not change visible styling.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Reproduce one-shot editor seed behavior

**Files:**
- Modify: `tests/unit/dingtalk-mention-editor-seed.test.tsx`
- Modify: `src/components/dingtalk/DingTalkMentionEditor.tsx:250-271`

**Interfaces:**
- Consumes: `DingTalkMentionEditorProps.seedSkillSlug?: string`
- Produces: consumed seed props no longer remove the current token; fresh mounts with no seed remain empty

- [x] **Step 1: Write the failing test**

Add a test that renders with `seedSkillSlug="skill-a"`, rerenders with `undefined`, verifies the existing `.skill-token` remains, then unmounts and mounts a fresh editor with `undefined` and verifies no `.skill-token` exists.

```tsx
it('keeps a consumed skill seed in the current editor but not a fresh editor', () => {
  const { container, rerender, unmount } = render(
    <DingTalkMentionEditor seedSkillSlug="skill-a" onSnapshotChange={vi.fn()} />,
  );

  expect(container.querySelector('.skill-token')).not.toBeNull();

  rerender(
    <DingTalkMentionEditor seedSkillSlug={undefined} onSnapshotChange={vi.fn()} />,
  );
  expect(container.querySelector('.skill-token')).not.toBeNull();

  unmount();
  const fresh = render(
    <DingTalkMentionEditor seedSkillSlug={undefined} onSnapshotChange={vi.fn()} />,
  );
  expect(fresh.container.querySelector('.skill-token')).toBeNull();
});
```

- [x] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/dingtalk-mention-editor-seed.test.tsx
```

Expected: FAIL because the current `seedSkillSlug === undefined` branch calls `removeSkillSpan`.

- [x] **Step 3: Implement the minimal editor change**

Change the seed effect so an absent seed resets only the instance guard and does not mutate the current editor DOM.

```tsx
if (!slug) {
  appliedSkillSeedRef.current = undefined;
  return;
}
if (appliedSkillSeedRef.current === slug) return;
appliedSkillSeedRef.current = slug;
const { title } = resolveSkillFromPlaza(slug);
insertSkillSpan(root, slug, title);
resizeEditor();
syncFromDom();
```

- [x] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/dingtalk-mention-editor-seed.test.tsx tests/unit/dingtalk-mention-composer-skill.test.ts
```

Expected: 2 test files pass.

### Task 2: Consume the Home URL seed

**Files:**
- Modify: `src/pages/Home/index.tsx:91-110`
- Test: `tests/unit/home-skill-seed.test.tsx`

**Interfaces:**
- Consumes: React Router `searchParams`
- Produces: `seedSkillSlug: string | undefined` that becomes `undefined` after `?skill=` is removed

- [x] **Step 1: Write the failing Home regression test**

Render `Home` under `MemoryRouter` with `initialEntries={['/?skill=skill-a']}` and mock the selected Home surface with a probe that records `seedSkillSlug`. Wait for URL cleanup and assert the last observed prop is `undefined`.

```tsx
await waitFor(() => {
  expect(observedSeeds).toContain('skill-a');
  expect(observedSeeds.at(-1)).toBeUndefined();
});
```

- [x] **Step 2: Run the Home test to verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/home-skill-seed.test.tsx
```

Expected: FAIL because `useState(() => searchParams.get('skill'))` retains `"skill-a"` after URL cleanup.

- [x] **Step 3: Implement the minimal Home change**

Replace the lifetime state with a live query-string derivation:

```tsx
const seedSkillSlug = searchParams.get('skill')?.trim() || undefined;
const [initialSkillSlug] = useState(() => seedSkillSlug);
```

Keep the existing `setSearchParams(..., { replace: true })` cleanup effect. Use
`initialSkillSlug` only in the legacy `?q=` effect so consuming the live editor
seed does not alter the pre-existing auto-send behavior.

- [x] **Step 4: Run regression tests**

Run:

```bash
pnpm exec vitest run tests/unit/home-skill-seed.test.tsx tests/unit/dingtalk-mention-editor-seed.test.tsx tests/unit/dingtalk-mention-composer-skill.test.ts
```

Expected: all selected test files pass.

### Task 3: Static verification and documentation review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Review: edited TypeScript and test files

**Interfaces:**
- Produces: no new public interface and no documentation drift

- [x] **Step 1: Run type checking**

```bash
pnpm run typecheck
```

Actual: exit code 2 because the repository baseline currently has unrelated
missing generated declarations, missing `reactflow` types, and existing type
errors. No reported error points to the files changed by this fix.

- [x] **Step 2: Check edited-file diagnostics**

Read IDE diagnostics for the edited source and test files. Expected: no newly introduced errors.

- [x] **Step 3: Confirm documentation impact**

Verify that the change only corrects the existing one-shot interaction and requires no README updates.

- [x] **Step 4: Review the final diff**

Confirm only the approved seed lifecycle, regression tests, and planning/design documentation changed. Do not commit.
