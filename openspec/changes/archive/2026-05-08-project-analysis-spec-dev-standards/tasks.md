## 1. Project Architecture Analysis

- [x] 1.1 Map `src/pages/` directory to business module names (e.g., Chat → `chat-*`, Settings → `settings-*`)
- [x] 1.2 Map `electron/services/` and `electron/main/` to capability naming patterns for main-process features
- [x] 1.3 Document cross-cutting concerns (e.g., `realtime-*`, `auth-*`) and their naming conventions
- [x] 1.4 Verify existing `openspec/specs/` directory is empty and record baseline state

## 2. Update openspec/config.yaml

- [x] 2.1 Add `context` field with StoClaw tech stack: Electron + React 19 + Vite + TypeScript, pnpm, key directories
- [x] 2.2 Add `rules.proposal` requiring Capabilities section to use business-module-aligned kebab-case names
- [x] 2.3 Add `rules.specs` requiring scenarios to reference AGENTS.md constraints (host-api boundary, Gateway proxy)
- [x] 2.4 Add `rules.tasks` requiring comms-checklist for communication changes and doc-sync for behavior changes
- [x] 2.5 Validate `config.yaml` syntax with `openspec validate` or equivalent lint

## 3. Create spec-directory-structure Standard

- [x] 3.1 Write `openspec/specs/spec-directory-structure/spec.md` defining capability naming rules
- [x] 3.2 Include examples of valid names (`chat-message-sync`, `settings-ai-provider`) and invalid names (`frontend-chat-component`)
- [x] 3.3 Define canonical directory layout: `openspec/changes/<change>/specs/<capability>/spec.md`
- [x] 3.4 Document cross-cutting capability naming strategy (semantic concern name, not module list)

## 4. Create spec-writing-standards Standard

- [x] 4.1 Write `openspec/specs/spec-writing-standards/spec.md` with proposal/design/spec/task artifact requirements
- [x] 4.2 Define normative language rule (SHALL/MUST) and scenario format (`#### Scenario:` with WHEN/THEN)
- [x] 4.3 Create checklist template for proposal review (Why, What Changes, Capabilities, Impact)
- [x] 4.4 Create checklist template for spec review (every requirement has ≥1 scenario, correct header levels)
- [x] 4.5 Define task-to-spec traceability requirement (each task references `### Requirement:` name)

## 5. Create spec-example-template Standard

- [x] 5.1 Write `openspec/specs/spec-example-template/spec.md` covering the three primary StoClaw change scenarios
- [x] 5.2 Create "New Renderer Page" template with placeholders for route, page component, store, host-api integration
- [x] 5.3 Create "New Electron Main-Process Capability" template with placeholders for handler, IPC channel, preload, host-api wrapper
- [x] 5.4 Create "UI Component Enhancement" template with placeholders for props, hooks, unit tests
- [x] 5.5 Ensure all templates include mandatory AGENTS.md constraint reminders (no direct ipcRenderer.invoke, no direct Gateway fetch)
- [x] 5.6 Ensure all templates include build/test/comms checklist reminders

## 6. Create spec-project-context Standard

- [x] 6.1 Write `openspec/specs/spec-project-context/spec.md` defining config.yaml update requirements
- [x] 6.2 Document context field requirements (tech stack, directories, domain knowledge)
- [x] 6.3 Document per-artifact rules for Renderer/Main boundary enforcement
- [x] 6.4 Document per-artifact rules for communication path changes (comms:replay, comms:compare)
- [x] 6.5 Document per-artifact rules for documentation synchronization (README updates)

## 7. Create Example Change Demonstration

- [x] 7.1 Create a sample OpenSpec change (e.g., `example-chat-typing-indicator`) demonstrating the full workflow
- [x] 7.2 Write a complete `proposal.md` following the new standards
- [x] 7.3 Write a complete `design.md` with decisions and rationale
- [x] 7.4 Write a complete `spec.md` with proper requirements and scenarios
- [x] 7.5 Write a complete `tasks.md` with traceable checkboxes
- [x] 7.6 Archive the example change or store it under `openspec/examples/`

## 8. Validation and Documentation

- [x] 8.1 Run `pnpm run lint` to ensure no markdown or formatting issues in new spec files
- [x] 8.2 Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for required OpenSpec workflow updates
- [x] 8.3 Update AGENTS.md if any new conventions were established that affect agent behavior
- [x] 8.4 Verify all 4 spec files are parseable by openspec CLI (`openspec validate` or status check)
