## 1. OpenSpec Baseline
- [x] 1.1 Create change folder, proposal, design, tasks, and ADDED requirements for sidebar section sticky interactions
- [x] 1.2 Self-check: delta specs use `## ADDED Requirements`, `### Requirement`, `#### Scenario:`, SHALL/MUST; design has Decisions + alternatives + `[Risk] → Mitigation`; tasks are checkbox groups with Requirement refs

## 2. Bottom Account Hotzone
- [x] 2.1 In expanded `Sidebar` profile footer, wrap name/company as `DropdownMenuTrigger asChild` and remove the gear icon from expanded layout (Requirement: Expanded account area opens account menu)
- [x] 2.2 Keep help QR independent, keep account/QR mutual exclusion, preserve collapsed compact settings entry and a11y labels (Requirement: Expanded account area opens account menu)
- [x] 2.3 Add/adjust account hotzone surfaces for default/hover/open/focus-visible in light and dark (Requirement: Expanded account area opens account menu)
- [x] 2.4 Add or extend a unit/component test covering expanded trigger without gear and collapsed entry still present

## 3. Shared Section Header
- [x] 3.1 Extract layout-private `SidebarCollapsibleSectionLabel` with sticky shell, main toggle, and right actions slot (Requirement: Sidebar section headers share interaction styling)
- [x] 3.2 Wire project, task, and recent headers to the shared component without nested buttons (Requirement: Sidebar section headers share interaction styling)

## 4. Project Visual and Menu
- [x] 4.1 Align project empty state + create action; hide batch control when empty (Requirement: Project hierarchy and empty state follow the approved design)
- [x] 4.2 Align primary chevron / secondary hierarchy line; keep selected session weight; remove duplicate new-chat from overflow menu (Requirement: Project hierarchy and empty state follow the approved design)
- [x] 4.3 Add project batch expand-all/collapse-all independent of module open (Requirement: Project and task groups support expand all and collapse all)

## 5. Task Multi-Open and Batch Expand/Collapse
- [x] 5.1 Replace `expandedTaskGroupKey` with map-like expansion; update all set/read sites including auto-focus append-only (Requirement: Task groups support independent expansion)
- [x] 5.2 Add task batch expand-all/collapse-all with all-expanded detection and control visibility (Requirement: Project and task groups support expand all and collapse all)
- [x] 5.3 Ensure top-level show-more does not overwrite group expansion (Requirement: Task groups support independent expansion)

## 6. Three-Level Sticky and Auto-Collapse
- [x] 6.1 Apply sticky tops `0 / 1× / 2× --sto-sidebar-section-sticky-h` with opaque shells (Requirement: Project task and recent headers form a sticky stack)
- [x] 6.2 Generalize scroll-collapse hook for project→task and task→recent; preserve group maps; suppress after manual expand (Requirement: Project task and recent headers form a sticky stack)
- [x] 6.3 Add targeted tests for sticky order and auto-collapse not clearing maps

## 7. i18n Theme Accessibility and Regression Guard
- [x] 7.1 Add zh/en/ja keys for new copy (empty projects, expand-all / collapse-all tooltips, etc.) (Requirement: Project hierarchy and empty state follow the approved design; Project and task groups support expand all and collapse all)
- [x] 7.2 Verify light/dark readability for headers and account hotzone (Requirement: Expanded account area opens account menu; Sidebar section headers share interaction styling)
- [x] 7.3 Confirm create/rename/new-chat/pin/unread/sort workflows unchanged (Requirement: Existing project and session workflows remain unchanged)

## 8. Verification and Report
- [x] 8.1 Run targeted unit tests and typecheck/eslint on touched files
- [x] 8.2 Diff-check scope; produce final report per docs §8

## 9. Batch Expand/Collapse Correction (no snapshot)
- [x] 9.1 Update OpenSpec proposal/design/spec/tasks: replace collapse+restore snapshot with expand-all/collapse-all by all-expanded state (Requirement: Project and task groups support expand all and collapse all)
- [x] 9.2 Replace pure helpers: remove snapshot/restore; add `areAllExpandableGroupsExpanded` / `expandAllGroups` / `collapseAllGroups` (Requirement: Project and task groups support expand all and collapse all)
- [x] 9.3 Wire project + task batch buttons to expand-all when not fully expanded, collapse-all when fully expanded; remove snapshot state (Requirement: Project and task groups support expand all and collapse all)
- [x] 9.4 Update zh/en/ja i18n (`expandAllGroups` / `collapseAllGroups`); remove unused `restoreExpandedGroups`; switch icons for next action (Requirement: Project and task groups support expand all and collapse all)
- [x] 9.5 Sync docs batch paragraphs + unit tests; run targeted verify commands (Requirement: Project and task groups support expand all and collapse all)
