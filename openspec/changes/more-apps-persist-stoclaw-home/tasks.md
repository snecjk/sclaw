## 1. Main persistence

- [x] 1.1 Add path helper + `more-apps` JSON read/write service under `~/.stoclaw/more-apps/apps.json` (Requirement: More Apps registry persists under user home)
- [x] 1.2 Implement migrate merge rules: empty disk accepts payload; non-empty disk skips overwrite (Requirement: One-time localStorage migration)

## 2. Host API

- [x] 2.1 Add `/api/more-apps` GET/PUT and `/api/more-apps/migrate` POST routes; register in host API server (Requirement: Renderer accesses registry via host-api)

## 3. Renderer

- [x] 3.1 Add `src/lib/more-apps-api.ts` wrapping `hostApiFetch` (Requirement: Renderer accesses registry via host-api)
- [x] 3.2 Update `more-apps` store: hydrate from host-api, persist via PUT, migrate then clear localStorage; no durable localStorage writes (Requirement: One-time localStorage migration; Renderer accesses registry via host-api)
- [x] 3.3 Trigger hydrate when More Apps page mounts (or app shell) so lists load before use (Requirement: More Apps registry persists under user home)

## 4. Tests & docs

- [x] 4.1 Unit tests for normalize/read/write/migrate merge logic (Requirement: More Apps registry persists under user home; One-time localStorage migration)
- [x] 4.2 Review README / README.zh-CN / README.ja-JP; update only if storage behavior is documented
