# Site Minimal STO PC Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Site template with the UI/UX-supplied STO PC visual specification.

**Architecture:** Treat `/Users/linqiang/Desktop/sto-pc-visual/tokens.css` as the visual source of truth. Keep router and SSO responsibilities intact, while replacing template tokens and splitting the visible shell into brand header, system tabs, sidebar, and card-based main content.

**Tech Stack:** React 19, TypeScript, Ant Design 5, React Router 7, Vitest.

**Spec:** `/Users/linqiang/Desktop/sto-pc-visual/{tokens.md,tokens.css,shell.md,layouts.md,page-head.md,tabs.md}`

## Global Constraints

- Use `#FF6700` as the only brand/accent color.
- Use 60px top bar, 28px system tab bar, 180px sidebar, 16px main/card padding, and 8px card radius.
- Default controls use 28px height; use 32px only for large modal actions.
- Do not modify SSO bootstrap, request behavior, publish behavior, or Assets templates.
- Use the supplied STO SVG mark inline; do not replace it with an `STO` text badge.
- Do not repeat an application title or breadcrumbs on the top-level home page.

---

### Task 1: Replace theme contracts with STO PC tokens

**Files:** `src/theme/tokens.ts`, `src/theme/antd-theme.ts`, `src/theme/theme.css`, `tests/unit/builtin-app-template-resources.test.ts`

- [ ] Add a failing resource test for `#FF6700`, `#F0F2F5`, 28px controls, and 180px sidebar tokens.
- [ ] Replace template color, typography, radius, elevation, and motion values with the supplied token system.
- [ ] Map equivalent semantic tokens into Ant Design and run the focused resource test.
- [ ] Commit the theme changes.

### Task 2: Implement the prescribed PC shell

**Files:** `src/layouts/AppHeader.tsx`, `src/layouts/AppLayout.tsx`, `src/layouts/AppSider.tsx`, `src/layouts/OpenTabs.tsx`, `src/index.css`, `tests/unit/builtin-app-template-resources.test.ts`

- [ ] Add a failing resource test for the inline SVG brand mark, `OpenTabs`, and exact shell dimensions.
- [ ] Render a 60px header, a 28px file-tab strip, a 180px sidebar, and a 16px padded gray main workspace.
- [ ] Keep routes synchronized through the existing navigation callback; Home remains non-closable.
- [ ] Run the focused resource test and commit the shell change.

### Task 3: Align top-level pages with the visual hierarchy

**Files:** `src/pages/HomePage.tsx`, `src/pages/DemoPage.tsx`, `src/components/PageHeader.tsx`, `src/components/ContentSection.tsx`, `src/index.css`, `tests/unit/builtin-app-template-resources.test.ts`

- [ ] Add a failing test that top-level pages do not render `__APP_TITLE__` or homepage breadcrumbs.
- [ ] Make top-level page content use white 16px-padded cards; only drill-down pages render breadcrumbs/section decoration.
- [ ] Verify focused resource and SSO contract tests, then commit.
