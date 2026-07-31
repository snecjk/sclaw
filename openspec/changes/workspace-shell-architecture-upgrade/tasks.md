## 0. Stage 0 — Audit & OpenSpec (this delivery)

- [x] 0.1 Read `AGENTS.md` and T2 master outline
- [x] 0.2 Audit git status/diff; preserve user docs changes (no checkout/restore/reset)
- [x] 0.3 Re-audit live code entrypoints (`MainLayout`, `App.tsx` Toast, Header slots, split insets, Fullscreen, Overlay)
- [x] 0.4 Read MasterGo Node `48:10836`（goto `UUOsojQL`）via HTTP DSL with user token；Cursor MCP server still broken — recorded Node IDs + sidebar 200/260/400；four workspace mins still blocked
- [x] 0.5 Author proposal / design / four capability specs / tasks
- [x] 0.6 Revise conflicting activity OpenSpecs (`chat-file-preview-enhancement`, `unify-toast-and-chat-error-feedback`, `overlay-scrollbar-surfaces/tasks.md`)
- [x] 0.7 Record approved mins: `closedWorkspaceMin=560`, `splitChatMin=480`, `splitPreviewMin=560`, `expandedPreviewMin=640` (user 2026-07-31) in `design.md` / `.openspec.yaml`
- [x] 0.8 User accepts Stage 0 documentation — confirmed by starting Stage 1 implement

## 1. Stage 1 — AppShell foundation
<!-- Requirement: Provincial AppShell uses fixed three-column Frame geometry -->
<!-- Requirement: AppShellLayoutProvider owns effective sidebar snapshot -->
<!-- Requirement: Collapse reasons are separated without a second user persistence key -->

- [x] 1.1 Convert provincial shell to sidebar | 8px | workspace Grid; Workspace wrapper owns top/right/bottom 8px Frame
- [x] 1.2 Add `AppShellLayoutProvider` above Routes + Toaster; snapshot fields per design
- [x] 1.3 Separate user/context collapse; Workflow editor uses context reason only
- [x] 1.4 Toast + Header/Portal consumers read effective width; remove `72/260` hard-coding; Settings/no-sidebar → 0
- [x] 1.5 Establish L0/L1 ownership tokens only (no final theme paint)
- [x] 1.6 Directed tests + eslint whitelist + typecheck + `git diff --check`; stop for manual QA
- [x] 1.7 Dark-mode smoke: Frame/hierarchy readable in both themes（人工验收；用户启动 Stage 4 时确认 Stage 1–3 已验收）

## 2. Stage 2 — Resizable sidebar
<!-- Requirement: Sidebar preferred width is user-resizable within approved bounds -->
<!-- Requirement: Collapse and restore respect snap thresholds and reasons -->
<!-- Requirement: Workspace minimum widths gate effectiveMax -->

- [x] 2.0 Confirm Stage 1 accepted — workspace mins already approved (560/480/560/640); otherwise STOP if Stage 1 not accepted
- [x] 2.1 Persist `sidebarPreferredWidth` (200–400, default 260); migrate invalid values
- [x] 2.2 Pointer resize via RAF CSS vars; commit on pointerup; disable width transition while dragging
- [x] 2.3 Snap / collapse threshold / restore preferred width; viewport reason when `effectiveMax < 200`
- [x] 2.4 Wire `effectiveMax` using approved mins by PreviewMode/page constraint（Stage 2 uses closed=560）
- [x] 2.5 MCP re-read for 200/260/400 hit targets if server available; record Node IDs（区域 5 / `48:16806` via HTTP DSL）
- [x] 2.6 Directed tests completed; dark-mode handle affordance left for manual QA

## 3. Stage 3 — Workspace layout modes
<!-- Requirement: PreviewMode is closed, split, or expanded inside the Workspace -->
<!-- Requirement: Split boundary has zero structural seam and Body-only handle -->
<!-- Requirement: ContentHeader slots are chatActions, previewActions, and layoutMode -->
<!-- Requirement: OverlayScrollbar is reused without rewrite -->
<!-- Requirement: ContentHeader vertical geometry is a single Token and centerline -->
<!-- Requirement: macOS traffic lights share the ContentHeader centerline -->
<!-- Requirement: Header-to-body spacing uses one explicit formula -->

- [x] 3.0 Confirm Stages 1–2 accepted; MCP nodes for dual/triple/expanded if required
- [x] 3.1 Introduce `PreviewMode`; remove DOM Fullscreen paths from preview expand UX
- [x] 3.2 Zero structural seam; delete inset-x seam + `row-span-2` + `translate-x(10px)` handle scheme
- [x] 3.3 Body-row Preview-side overlay handle (8px hit); reuse `useSplitPanelResize`
- [x] 3.4 Migrate Header to `chatActions + previewActions + layoutMode`; remove living `actions`/`panelActions` triad
- [x] 3.5 Keep Conversation mounted across expanded; verify draft/scrollTop
- [x] 3.6 Align OverlayScrollbar rail to boundary without rewriting Overlay primitive
- [x] 3.8 Fix unified Header vertical contract after Stage 3 QA fail: Token height, centerline, trafficLightPosition calibration, 8+8 spacing formula, pixel-relation tests
- [x] 3.7 Directed tests for Header vertical metrics + traffic lights + header-to-body spacing; stop for **manual QA**（用户确认 Stage 1–3 已验收后进入 Stage 4）

## 4. Stage 4 — Surface hierarchy & integration
<!-- Requirement: Shell surfaces follow L0–L3 ownership -->
<!-- Requirement: Light and dark share hierarchy with tokenized appearance -->
<!-- Requirement: Integration acceptance preserves protected behaviors -->

- [x] 4.0 Confirm Stages 1–3 accepted（用户明确启动 Stage 4）
- [x] 4.1 Tokenize L0–L3 appearance per `docs/sto-design.md`; no hierarchy forks per theme（MCP 无 dark Frame；dark 由 L0/L1/L2 契约推导）
- [x] 4.2 Run stage-4 acceptance matrix; list unverified OS/theme explicitly（定向自动测试已跑；Windows / 人工截图矩阵见交付报告「未验证」）
- [x] 4.3 Protect Overlay, Settings, App Plaza, Embed, full legacy rail, user uncommitted diffs（白名单外未改布局/状态机）
- [x] 4.4 Doc sync review (`README*`) only if behavior/interfaces changed; stop after report（README 无需同步；仅更新 `02-styles.mdc` + OpenSpec tasks）

## 5. Cross-cutting guards (every implement stage)

- [x] 5.1 No dependency/lockfile/build/CI/script edits
- [x] 5.2 No `git checkout` / `restore` / `reset`; preserve user modifications
- [x] 5.3 Use `pnpm exec vitest run <files>` (not `pnpm test -- <files>`)
- [ ] 5.4 Do not start the next stage without explicit user confirmation
