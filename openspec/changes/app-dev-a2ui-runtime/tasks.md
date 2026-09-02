## 1. OpenSpec & branch hygiene

- [x] 1.1 Create change `app-dev-a2ui-runtime` (proposal/design/specs/tasks) on `cy/a2ui-runtime`
- [x] 1.2 Stash prior AGUI WIP; keep branch clean of dual-track residue

## 2. Template host (Requirement: A2UI page assets drive preview / Single-package app root / Dark-mode)

- [x] 2.1 Add `resources/app-templates/react-a2ui-template` single-package scaffold
- [x] 2.2 Implement A2UI `MessageProcessor` host loading `src/pages/home.page.json`
- [x] 2.3 Register `basicCatalog` only（antd Catalog 明确延后）
- [x] 2.4 Add light/dark CSS variables for host chrome

## 3. App-dev wiring (Requirement: Single-package app root / Dev server cwd)

- [x] 3.1 Update template validation & local path to `react-a2ui-template`; prefer local template when unpackaged
- [x] 3.2 Resolve `npm install` / dev server cwd to root or legacy `frontend/`
- [x] 3.3 Rewrite create-app `AGENTS.md` guidance for pages/contracts-first
- [x] 3.4 Allow import of root-`package.json` apps

## 4. Action + pages (Requirement: Action registry execution / Multi-page asset loading)

- [x] 4.1 Action registry executor + Button wiring (`customer.list`, `app.navigate`)
- [x] 4.2 Multi-page registry + hash routing (`#home`, `#customer-list`)
- [x] 4.3 Remove antd dependency and sto AntdButton sample
- [x] 4.4 Unify copy to `src/pages/`

## 5. Follow-ups

- [x] 5.1 Engineering: pack & upload OSS zip; set `REACT_TEMPLATE_ZIP_URL`
- [ ] 5.2 Catalog: antd / STO custom components（明确延后）
- [ ] 5.3 AG-UI session transport（接口已预留 `ActionTransport`，完整接入延后）
