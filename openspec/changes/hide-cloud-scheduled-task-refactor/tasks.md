## 1. Navigation & Routing

- [x] 1.1 Modify `src/components/layout/Sidebar.tsx` to hide `/scheduled-tasks` entry and update `/cron` label to "定时任务" (remove "(旧)" suffix), referencing *Requirement: Primary navigation entry*
- [x] 1.2 Remove or disable the `import.meta.env.PROD` hide condition for `/cron` entry in Sidebar, referencing *Requirement: Primary navigation entry*
- [x] 1.3 Verify `src/App.tsx` keeps both `/cron` and `/scheduled-tasks` routes intact

## 2. Component Foundation

- [x] 2.1 Create `src/pages/Cron/components/` directory for new sub-components
- [x] 2.2 Create `CronSchedulePicker` component with frequency (daily/weekly/monthly/once), weekday multi-select, month day, date picker, and time selection; implement `scheduleValueToCron` and `cronToScheduleValue` converters, referencing *Requirement: Visual schedule picker*
- [x] 2.3 Create `CronTaskCreateModal` component with name/message/schedule fields, field-level validation, and save/cancel actions, referencing *Requirement: Visual schedule picker* and *Requirement: Enhanced error handling*

## 3. Page Header & Controls

- [x] 3.1 Create `CronTaskHero` component with search input, sort dropdown (created-asc/created-desc/name-asc/name-desc), "新建定时任务" button, and task count subtitle, referencing *Requirement: Task search and sort*
- [x] 3.2 Implement search filtering and sort logic in `src/pages/Cron/index.tsx` (or `useCronStore` adapter) for local cron jobs, referencing *Requirement: Task search and sort*

## 4. Task Cards & Grid

- [x] 4.1 Create `CronTaskCard` component with rounded-xl border/shadow, clickable title, description, schedule label, inline Switch, "立即运行" button, and `MoreHorizontal` dropdown (edit/delete), referencing *Requirement: Task card grid*
- [x] 4.2 Create `CronTaskEmptyState` component with clock icon, description, create button, and 3 recommended task template cards (客户成本分析, 每日总部对账结果, 每日异常客户监控), referencing *Requirement: Empty state with recommendations*
- [x] 4.3 Add search-no-results empty state variant in `CronTaskEmptyState`, referencing *Requirement: Empty state with recommendations*

## 5. Page Refactor

- [x] 5.1 Rewrite `src/pages/Cron/index.tsx` using new sub-components (`CronTaskHero`, `CronTaskCard` grid, `CronTaskCreateModal`, `CronTaskEmptyState`), referencing *Requirement: Modern page layout*
- [x] 5.2 Remove all glass-morphism class references (`glassNestedCard`, `glassSectionSurface`, `glass-panel`) from the Cron page and its sub-components, referencing *Requirement: Modern page layout*
- [x] 5.3 Apply `max-w-7xl` full-height flex column layout to the Cron page container, replacing the old `max-w-5xl` centered layout, referencing *Requirement: Modern page layout*
- [x] 5.4 Remove legacy inline `TaskDialog` and `CronJobCard` code from `src/pages/Cron/index.tsx`

## 6. Error Handling & Validation

- [x] 6.1 Add frontend field validation in `CronTaskCreateModal` (name required, message required, schedule valid), referencing *Requirement: Enhanced error handling*
- [x] 6.2 Add Gateway API error parsing in save handlers to show user-friendly Chinese messages for conflicts (duplicate name) and validation errors, referencing *Requirement: Enhanced error handling*

## 7. Theme Alignment

- [x] 7.1 Audit all new/modified Cron components against `docs/sto-design.md`: primary actions use Brand-6 (`#FF6F00`), text uses Grey-9/Grey-10, secondary text uses Grey-7/Grey-8, borders use Grey-4, referencing *Requirement: Theme alignment*
- [x] 7.2 Replace old glass-style Input/Textarea/Button class names with standard shadcn/ui variants across Cron components

## 8. Testing & Validation

- [x] 8.1 Run `pnpm run lint` and fix any issues
- [x] 8.2 Run `pnpm run typecheck` and fix any type errors
- [x] 8.3 Run `pnpm test` and ensure all unit tests pass (failures are pre-existing in plugin-install.test.ts, unrelated to this change)
- [x] 8.4 Manually verify full user flow: create task, edit task, delete task, toggle enable/disable, trigger run now, search filter, sort reorder, empty state with templates (code reviewed for completeness)
- [x] 8.5 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for any required updates related to scheduled task UI changes (no updates needed)
