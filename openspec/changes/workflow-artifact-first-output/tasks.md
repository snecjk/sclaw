## 1. Protocol and Validation

- [x] 1.1 Add model artifact drafts and canonical artifact normalization (Requirement: Client canonicalizes artifact metadata)
- [x] 1.2 Enforce workspace path and regular-file validation (Requirement: Artifact paths remain inside the node workspace)
- [x] 1.3 Enforce the 1024-byte inline text boundary in retry validation (Requirement: Large text is transferred as an artifact)

## 2. Runtime and Prompt

- [x] 2.1 Remove HTML-specific compilation and materialization (Requirement: Runtime prompts use the artifact-first contract)
- [x] 2.2 Register only declared files and persist canonical packets everywhere (Requirement: Models declare workspace artifacts without embedding file bodies)
- [x] 2.3 Reuse final OUTPUT artifacts without fallback files (Requirement: Terminal output is format independent)
- [x] 2.4 Replace verbose prompts with engine-specific compact artifact-first instructions (Requirement: Runtime prompts use the artifact-first contract)
- [x] 2.5 Add prompt, output, payload and artifact byte telemetry (Requirement: Models declare workspace artifacts without embedding file bodies)

## 3. Verification and Documentation

- [x] 3.1 Add format, path security, large-text, multi-artifact and engine parity unit tests (Requirement: Client canonicalizes artifact metadata)
- [x] 3.2 Add the 7.9 KB HTML regression and obsolete `payload.html` diagnostic test (Requirement: Runtime prompts use the artifact-first contract)
- [x] 3.3 Review README documentation; update the repository's available README.md (README.zh-CN.md and README.ja-JP.md are not present) (Requirement: Models declare workspace artifacts without embedding file bodies)
- [x] 3.4 Run typecheck, unit tests, comms replay and comms comparison; record unrelated repository baseline failures separately (Requirement: Terminal output is format independent)

## 4. Compact Run Status

- [x] 4.1 Add status, detail, and diagnostic run-read views with compact SQLite projections (Requirement: Run status responses are compact by default)
- [x] 4.2 Use status by default for tools/cards and detail explicitly for the Workflow Designer timeline (Requirement: Run status responses are compact by default)
- [x] 4.3 Add response-shape and heavy-field omission regression tests (Requirement: Run status responses are compact by default)
