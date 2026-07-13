## Why

Users need to organize sidebar「最近」sessions into custom groups without changing Gateway/session lifecycle. Grouping is local UI state only.

## What Changes

- Zustand persist store for recent message groups and session→group mapping
- Sidebar renders groups above「最近」;「最近」shows ungrouped sessions only
- Session row `...` menu: rename / group submenu / delete
- Group row menu: rename / dissolve; dialogs for create, rename, dissolve confirm
- Updated session delete copy + success toast

## Capabilities

### New Capabilities

- `sidebar-recent-message-groups`: local grouping UX in expanded sidebar

## Impact

- `src/stores/sidebar-recent-groups.ts`, `src/lib/sidebar-recent-groups.ts`
- `src/components/layout/Sidebar.tsx` and new sidebar recent group components
- i18n `common.json` (zh/en/ja)
