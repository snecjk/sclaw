## ADDED Requirements

### Requirement: Primary navigation entry
The system SHALL present the legacy `/cron` page as the sole user-visible scheduled task entry point in the primary sidebar navigation. The sidebar label SHALL read "定时任务" without the "(旧)" suffix. The `/scheduled-tasks` cloud entry SHALL be hidden from the sidebar but its route and implementation code SHALL remain intact for future releases.

#### Scenario: User views sidebar navigation
- **WHEN** the user opens the StoClaw application
- **THEN** the sidebar primary navigation contains a "定时任务" entry linking to `/cron`
- **AND** the `/scheduled-tasks` cloud entry is NOT visible in the sidebar
- **AND** the `/cron` entry is visible in both development and production builds

### Requirement: Modern page layout
The Cron page SHALL adopt a modern layout consistent with the STO design system. The page container SHALL use `max-w-7xl` width with full-height flex column layout. All cards and surfaces SHALL use standard `rounded-xl border border-border bg-background shadow-sm` styling instead of glass-morphism effects.

#### Scenario: User navigates to Cron page
- **WHEN** the user clicks the "定时任务" sidebar entry
- **THEN** the Cron page renders with `max-w-7xl` centered container
- **AND** the page uses standard border/shadow surfaces aligned with `docs/sto-design.md`
- **AND** no glass-morphism CSS classes (e.g., `glassNestedCard`, `glassSectionSurface`) are applied

### Requirement: Task search and sort
The system SHALL provide a search input and sort dropdown in the page header. The search SHALL filter tasks by name and description case-insensitively. The sort dropdown SHALL support ordering by creation time (ascending/descending) and name (A-Z/Z-A).

#### Scenario: User searches for a task
- **WHEN** the user types "report" into the search input
- **THEN** the task grid displays only tasks whose name or description contains "report"
- **AND** the task count subtitle updates to reflect filtered results

#### Scenario: User changes sort order
- **WHEN** the user selects "按名称 A-Z" from the sort dropdown
- **THEN** the task grid reorders tasks alphabetically by name in ascending order
- **AND** the selected sort option remains highlighted in the dropdown

### Requirement: Task card grid
The system SHALL display cron jobs in a responsive 3-column card grid (1 column on mobile, 2 on tablet, 3 on desktop). Each card SHALL use `rounded-xl` styling with border and shadow. The card SHALL display the task name as a clickable edit button, description, schedule label, an inline Switch toggle, a "立即运行" button, and a `MoreHorizontal` dropdown menu containing "编辑任务" and "删除任务" actions.

#### Scenario: User views task cards
- **WHEN** the user navigates to the Cron page with existing tasks
- **THEN** tasks render in a 3-column grid on desktop
- **AND** each card shows the task name, description, schedule label, and enabled toggle
- **AND** hovering the card highlights its border with `primary/30`

#### Scenario: User opens card actions menu
- **WHEN** the user clicks the `MoreHorizontal` button on a task card
- **THEN** a dropdown menu appears with "编辑任务" and "删除任务" options
- **AND** clicking outside the menu closes it

#### Scenario: User triggers a task immediately
- **WHEN** the user clicks the "立即运行" button on a task card
- **THEN** the system sends a trigger request to the Gateway
- **AND** a loading state is shown on the button during the request
- **AND** a toast notification confirms the trigger result

### Requirement: Visual schedule picker
The create/edit dialog SHALL provide a visual `SchedulePicker` component supporting frequency selection (daily/weekly/monthly/once), weekday multi-select for weekly mode, month day selection for monthly mode, date picker for once mode, and time selection in 5-minute increments. The picker SHALL convert the visual selection to a standard 5-field cron expression for Gateway submission.

#### Scenario: User creates a daily task
- **WHEN** the user opens the create dialog, selects "每天", and sets time to "09:00"
- **THEN** the schedule value converts to `0 9 * * *`
- **AND** the task is submitted to the Gateway with this cron expression

#### Scenario: User creates a weekly task
- **WHEN** the user selects "每周", checks Monday and Wednesday, and sets time to "08:00"
- **THEN** the schedule value converts to `0 8 * * 1,3`
- **AND** the task is saved successfully

#### Scenario: User edits an existing task
- **WHEN** the user opens the edit dialog for a task with schedule `0 9 * * 1,3,5`
- **THEN** the SchedulePicker pre-populates with "每周", checked weekdays 1/3/5, and time "09:00"

### Requirement: Empty state with recommendations
When no tasks exist, the system SHALL display an empty state with a large clock icon, descriptive text, a "新建定时任务" button, and a grid of 3 recommended task template cards (客户成本分析, 每日总部对账结果, 每日异常客户监控). When a search returns no results, a simplified empty state SHALL be shown.

#### Scenario: User views empty Cron page
- **WHEN** the user navigates to the Cron page with no tasks
- **THEN** the empty state displays with recommended task templates
- **AND** clicking "添加" on a template pre-fills the create dialog with the template's name and description

#### Scenario: User searches with no matches
- **WHEN** the user searches for a non-existent task name
- **THEN** a simplified empty state shows "未找到匹配的任务" with a prompt to create new

### Requirement: Enhanced error handling
The system SHALL provide field-level validation in the create/edit dialog (name required, message required, schedule valid). For API errors, the system SHALL parse common Gateway error patterns and display user-friendly Chinese messages (e.g., "任务名称已存在" for conflicts, "字段长度超过限制" for validation errors).

#### Scenario: User submits invalid form
- **WHEN** the user attempts to save a task without entering a name
- **THEN** the name field shows an error indicator
- **AND** a toast or inline message prompts "请输入任务名称"

#### Scenario: API returns conflict error
- **WHEN** the user creates a task with a duplicate name
- **THEN** the system displays "任务名称已存在，请使用其他名称" instead of raw error text

### Requirement: Theme alignment
All visible UI elements on the Cron page SHALL align with `docs/sto-design.md`. Primary actions SHALL use Brand-6 (`#FF6F00`) via `bg-primary`. Text hierarchies SHALL use Grey-9/Grey-10 for primary text and Grey-7/Grey-8 for secondary text. Success states SHALL use Green-6, errors SHALL use Red-6.

#### Scenario: Page renders with correct theme
- **WHEN** the Cron page loads
- **THEN** the "新建定时任务" button uses Brand-6 background
- **AND** card borders use Grey-4 (`#E5E6EB`)
- **AND** description text uses Grey-8 (`#86909C`)
