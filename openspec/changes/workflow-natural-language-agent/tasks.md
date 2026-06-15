## 1. Intent Recognition & Natural Language Trigger

- [x] 1.1 Create `src/hooks/use-workflow-intent.ts` with `detectWorkflowIntent(text)` function (Requirement: System detects workflow intent from natural language)
- [x] 1.2 Implement `resolveTemplateFromText(text)` that calls `searchWorkflowTemplates` and applies matchScore thresholds (Requirement: System detects workflow intent from natural language)
- [x] 1.3 Modify `src/pages/Chat/ChatInput.tsx` to keep `/` command as UI shortcut but pass selected template into message context instead of direct execution (Requirement: Slash command triggers template picker)
- [x] 1.4 Modify `src/pages/Chat/index.tsx` `handleSend` to call intent detection before normal chat flow, routing to workflow path when intent is detected (Requirement: System detects workflow intent from natural language)
- [x] 1.5 Add intent cancellation handling ("取消", "不执行了") to clear `pendingWorkflow` state (Requirement: System prevents workflow intent false positives)

## 2. AI-Guided Parameter Confirmation

- [x] 2.1 Enhance `src/lib/workflow-form-utils.ts` `buildWorkflowFormConfig` to also generate AI guidance text from schema fields (Requirement: AI generates natural language guidance for workflow parameters)
- [x] 2.2 Modify `src/stores/chat.ts` `sendMessage` to support injecting hidden `workflowContext` (template name, schema summary) into Gateway message (Requirement: AI generates natural language guidance for workflow parameters)
- [x] 2.3 Refactor `src/hooks/use-workflow-send.ts` `sendWithWorkflow` into two-phase: Phase 1 (AI guidance) fetches schema and sends context to Gateway; Phase 2 (execution) creates and starts workflow after form submission (Requirement: AI generates natural language guidance for workflow parameters)
- [x] 2.4 Modify `src/pages/Chat/ChatMessage.tsx` to detect workflow guidance context and auto-render `parameter_form` alongside AI text (Requirement: Frontend renders parameter form alongside AI guidance)
- [x] 2.5 Implement parameter extraction from natural language replies in `use-workflow-send.ts` `tryResolvePendingWorkflow`, merging extracted values into `collectedInputs` (Requirement: System extracts parameter values from natural language)

## 3. Workflow Creation & Execution

- [x] 3.1 Ensure `createAndStartWorkflowDirect` handles both form submission and natural language parameter confirmation paths (Requirement: Workflow creation and execution supports natural language flow)
- [x] 3.2 Support "create and execute in one step" when user intent indicates immediate execution (Requirement: Workflow supports create-and-execute in one step)
- [x] 3.3 Insert assistant message with "参数已确认，正在分析..." + `workflow_card` content block after workflow start (Requirement: Workflow creation and execution supports natural language flow)
- [x] 3.4 Maintain concurrent execution guard (max 5 active workflows per session) in natural language flow (Requirement: Concurrent workflow execution guard)

## 4. Execution Completion & AI Summary

- [x] 4.1 Modify `electron/main/services/workflow-execution-tracker.ts` to include `result` and `artifacts` in `workflow:status-update` IPC payload when status becomes `completed` or `failed` (Requirement: System triggers AI summary after workflow completion)
- [x] 4.2 Create `src/hooks/use-workflow-completion.ts` that listens for completed workflow status, fetches full run result via `getWorkflowRun`, and constructs a structured user message with `[workflow:complete]` tag (Requirement: System triggers AI summary after workflow completion)
- [x] 4.3 Ensure AI summary message includes: execution status, key metrics, anomaly overview, and artifact references (Requirement: AI generates result summary)
- [x] 4.4 Handle failed execution summary with error reason and suggested next steps (Requirement: Failed execution summary)
- [x] 4.5 Render artifact cards with "查看产物" action in the final summary message (Requirement: System preserves workflow execution artifacts)

## 5. Long-Term Memory & Recovery

- [x] 5.1 Enhance `src/stores/workflow-memory.ts` to store `lastRunId`, `lastStatus`, and `completedAt` fields (Requirement: System supports long-term workflow memory)
- [x] 5.2 Implement memory-based recovery in `tryResolvePendingWorkflow`: detect intents like "执行刚才的"/"再跑一遍" and load latest workflow from memory (Requirement: User re-executes a remembered workflow)
- [x] 5.3 Support parameter override on re-execution: update `collectedInputs` with new values from natural language before calling `startWorkflow` (Requirement: User modifies parameters before re-execution)
- [x] 5.4 Handle expired memory gracefully (older than 30 days) by informing user and prompting new workflow creation (Requirement: Workflow memory expires)

## 6. Integration & Testing

- [x] 6.1 Run `pnpm run typecheck` and fix all type errors introduced by new hooks and store changes
- [x] 6.2 Run `pnpm run lint` and fix style issues
- [ ] 6.3 Run `pnpm run comms:replay` and `pnpm run comms:compare` if IPC or Gateway communication paths are modified
- [x] 6.4 Update `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md` with natural language trigger and AI guidance flow documentation
- [x] 6.5 Update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` if workflow usage instructions changed
