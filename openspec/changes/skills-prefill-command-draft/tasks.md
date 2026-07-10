## 1. Spec

- [x] 1.1 Add `skills-marketplace` requirement for installed skill use draft insertion
- [x] 1.2 Document that workflow deep-link auto-send remains unchanged

## 2. Implementation

- [x] 2.1 Update Home `?q=` handling so pure skill prompt links populate composer draft state instead of calling send
- [x] 2.2 Keep `q + workflowId` on the existing auto-send path
- [x] 2.3 Update `DingTalkMentionEditor` seed handling so URL cleanup does not clear seeded draft text
- [x] 2.4 Keep skill plaza `newSession()`, navigation, and usage-count calls unchanged

## 3. Validation

- [x] 3.1 Add a regression test for preserving seeded draft text after parent seed cleanup
- [x] 3.2 Run the targeted seed handling test
- [x] 3.3 Run `pnpm run typecheck` or the local equivalent without triggering package installation
- [x] 3.4 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required updates
