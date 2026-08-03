## 1. CLI + binding foundation
- [x] 1.1 Add `listStoApps` / `cloneStoApp` in `sto-app-service` (Requirement: Collaboration commands via CLI)
- [x] 1.2 Add userData binding store upsert/get/remove/list (Requirement: Cloud catalog is authoritative)
- [x] 1.3 On create success, persist applicationId binding (Requirement: Local binding and edit vs clone)

## 2. Catalog merge API
- [x] 2.1 Rewrite `listDevApps` to merge cloud list + bindings + path checks (Requirement: Cloud catalog is authoritative)
- [x] 2.2 Add `cloneDevApp` host route (pick path is renderer-side; API accepts parentDir) (Requirement: Local binding and edit vs clone)
- [x] 2.3 Push wrapper: pull-then-push; surface merge-required (Requirement: Collaboration commands via CLI)

## 3. UI
- [x] 3.1 DevAppCard: 继续编辑 vs 拉取到本地（每次选目录）+ dark-mode labels (Requirement: Local binding and edit vs clone)
- [x] 3.2 Workbench: pull / merge-continue actions when remote-ahead or merge-required (Requirement: Status visibility / Collaboration commands via CLI)
- [x] 3.3 Catalog refresh error toast when list CLI fails (Requirement: Cloud catalog is authoritative)
