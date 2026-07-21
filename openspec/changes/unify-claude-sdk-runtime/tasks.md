# Tasks

## 1. service-claude-runtime

- [x] 1.1 Implement the shared runtime facade for `Claude SDK consumers use a shared runtime boundary`.
- [x] 1.2 Centralize launch selection and fallback for `Model selection is catalog-aware and consistent`.
- [x] 1.3 Centralize configuration-directory serialization and credential environment construction for `Claude process environment coordination is centralized`.
- [x] 1.4 Migrate interactive chat, local scheduled tasks, and execution-memory summarization while preserving `Feature-specific behavior remains caller-owned`.
- [x] 1.5 Add regression tests covering `Claude SDK consumers use a shared runtime boundary` and `Model selection is catalog-aware and consistent`.
- [x] 1.6 Run TypeScript checking and relevant Claude unit tests for all requirements.
- [x] 1.7 Run `pnpm run comms:replay` and `pnpm run comms:compare` because interactive Claude delivery is in scope for `Feature-specific behavior remains caller-owned`.
- [x] 1.8 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for documentation impact from `Claude SDK consumers use a shared runtime boundary` (only `README.md` exists in this checkout; no user-visible documentation change is required).
