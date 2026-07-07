## Architecture

- **State**: `useSidebarRecentGroupsStore` (persist `stoclaw:sidebar-recent-groups`) — separate from `useChatStore`
- **Pure fn**: `buildSidebarRecentGroupSections` in `src/lib/sidebar-recent-groups.ts`
- **Visual**: MasterGo MCP `8:89594` > `02-styles.mdc`; sidebar surfaces in `src/lib/surfaces.ts`

## Behavior

- Groups sorted by `createdAt` asc; empty groups retained
- `assignSessionToGroup` / `createGroupAndAssignSession` auto-expand target group
- Effect expands group when `currentSessionKey` maps to a collapsed group
- Collapsed sidebar: flat recent list unchanged
- `recentVisibleCount` applies to ungrouped list only

## Delete

- On session delete success: `removeSessionAssignment(key)` + toast
- Session confirm dialog: MCP copy (title + description), confirm「确定」

## References

- `docs/侧边栏最近消息分组-Cursor开发文档.md`
- `docs/sto-design.md`, `.cursor/rules/02-styles.mdc`
