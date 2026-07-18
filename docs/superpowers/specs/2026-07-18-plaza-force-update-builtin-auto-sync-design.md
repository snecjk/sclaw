# Plaza force_update + is_builtin auto-sync design

Date: 2026-07-18

## Summary

Skill Plaza API now returns `force_update` and `is_builtin`. The client auto-updates forced skills when the local version lags, and auto-installs remote builtins that are not yet installed—without replacing local `preinstalled-manifest` packaging.

## Product decisions

- Local preinstall remains source for bundled skills; `is_builtin` only fills remote marketplace packages (option B).
- Auto-sync runs on every plaza list fetch path in Main (not login-only).
- `force_update` upgrades installed skills only; it does not install missing ones.
- Approach: Main-process `PlazaSkillAutoSync` scheduled after `getPlazaSkills` local overlay (fire-and-forget).

## Architecture

```
STO plaza API
  → SkillPlazaService.getPlazaSkills
  → normalize (forceUpdate / isBuiltin)
  → overlayLocalState (installed / installedVersion)
  → return list to renderer
  → void PlazaSkillAutoSync.schedule(skills)
       → SkillManager.install(...)
       → batch-end gateway notify
```

## Rules

| Flag | Condition | Action |
|------|-----------|--------|
| forceUpdate | installed && remote newer && not local-preinstall | install force:true |
| isBuiltin | !installed && not local-preinstall coverage | install force:false |

## Non-goals

- Replace local preinstall
- Toast/progress UI in v1
- Renderer-driven auto-install

## OpenSpec

See `openspec/changes/plaza-force-update-builtin-auto-sync/`.
