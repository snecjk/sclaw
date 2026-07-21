# Plaza force_update / is_builtin Auto-Sync Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** After each plaza list fetch, asynchronously auto-install remote builtins and force-update lagging installs via SkillManager.

**Architecture:** `normalizeSkillSummary` maps API flags → `PlazaSkillAutoSync.schedule` runs after `overlayLocalState` in `getPlazaSkills` (fire-and-forget) → `SkillManager.install` + batch-end gateway notify.

**Tech Stack:** Electron main, TypeScript, Vitest, existing SkillManager / skill-version helpers.

## Global Constraints

- Do not block plaza list responses on auto-sync.
- Skip local preinstall whitelist / `stoclaw-preinstalled` / preinstall marker for auto force-update and builtin install.
- `forceUpdate` only upgrades installed skills; `isBuiltin` only installs missing.
- No renderer toast in v1.

---

### Task 1: Types + field mapping

**Files:**
- Modify: `src/types/skill-plaza.ts`
- Modify: `electron/services/skill-plaza-service.ts` (`SkillSummary`, `normalizeSkillSummary`)

- [ ] Add `forceUpdate?: boolean` and `isBuiltin?: boolean` to both SkillSummary definitions
- [ ] Map in `normalizeSkillSummary` from camelCase (convertKeys already turns snake_case)

### Task 2: PlazaSkillAutoSync + unit tests

**Files:**
- Create: `electron/services/plaza-skill-auto-sync.ts`
- Create: `tests/unit/plaza-skill-auto-sync.test.ts`

- [ ] Export `collectPlazaAutoSyncActions(skills, preinstalledSlugs)` for pure filtering
- [ ] Export `schedulePlazaSkillAutoSync(skills)` with in-flight Set, concurrency ≤3, `getSkillManager().install`, batch-end `notifyGatewayAfterSkillBatch`
- [ ] Tests for force-update / builtin / skip preinstall / version aligned

### Task 3: Wire getPlazaSkills

**Files:**
- Modify: `electron/services/skill-plaza-service.ts`

- [ ] After final skills array for normal (non-office-only) list path, `void schedulePlazaSkillAutoSync(skills)`
- [ ] Mark openspec tasks complete when verified

### Task 4: Verify

- [ ] `pnpm exec vitest run tests/unit/plaza-skill-auto-sync.test.ts`
