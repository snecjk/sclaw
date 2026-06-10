## 1. Types & API Foundation

- [x] 1.1 Create `src/types/workflow.ts` with `WorkflowTemplate`, `WorkflowTemplateDetail`, `WorkflowExecutionState`, `WorkflowCardBlock` types
- [x] 1.2 Create `src/lib/workflow-api.ts` with `fetchWorkflowTemplates`, `fetchWorkflowDetail`, `createWorkflow`, `executeWorkflow`
- [x] 1.3 Extend `ContentBlock` union in `src/stores/chat/types.ts` to include `workflow_card`

## 2. Workflow Trigger (ChatInput)

- [x] 2.1 Create `src/stores/workflows.ts` Zustand store for template list and selection state
- [x] 2.2 Create `src/components/workflow/WorkflowPicker.tsx` dropdown component for template selection
- [x] 2.3 Create `src/components/workflow/WorkflowChip.tsx` selected template tag component
- [x] 2.4 Modify `src/pages/Chat/ChatInput.tsx` to add `/` button, WorkflowPicker, and WorkflowChip rendering
- [x] 2.5 Modify `src/pages/Chat/ChatInput.tsx` `handleSend` to pass `workflowId` to `onSend`
- [x] 2.6 Enforce non-empty input when workflow is selected (Requirement: Message with workflow cannot be empty)

## 3. Workflow Form Mapping & Display

- [x] 3.1 Implement `schema.fields` to `UserFormConfig.fields` mapping with component type conversion (`single_select` → `select`, `multi_select` → `multiselect`, etc.)
- [x] 3.2 Implement default value population from `defaultPreset.values` (Requirement: Default values from preset are applied to form fields)
- [x] 3.3 Implement extractable parameter value extraction from user input text using `extractPattern` (Requirement: User input text can be used to extract parameter defaults)
- [x] 3.4 Modify `src/pages/Chat/index.tsx` to fetch template detail on selection, map fields, and show form via `showForm()`
- [x] 3.5 Handle form submission: call `createWorkflow` API with templateId, userMessage, and form values
- [x] 3.6 Handle workflow creation response: call `executeWorkflow` API, then send message via Gateway with `workflowId` and `executionId`

## 4. Main Process Tracker

- [x] 4.1 Create `electron/main/services/workflow-execution-tracker.ts` with `ExecutionSession` Map, polling logic, and state management
- [x] 4.2 Implement `startTracking` method with 2-second interval polling
- [x] 4.3 Implement `getState` method for `workflow:sync-state` IPC
- [x] 4.4 Implement memory limits: max 50 tracked executions, evict oldest completed/failed, 5-minute TTL cleanup timer
- [x] 4.5 Implement exponential backoff retry (2s → 4s → 8s → max 30s) with 3-attempt limit
- [x] 4.6 Implement stall detection: warn if steps unchanged for 30 seconds
- [x] 4.7 Implement user-friendly error mapping (404 → "记录不存在", 5xx → "服务器繁忙", etc.)
- [x] 4.8 Implement IPC broadcast with `sessionKey` filtering: `workflow:status-update` to all web contents
- [x] 4.9 Register IPC handlers in `electron/main/ipc-handlers.ts`: `workflow:startTracking`, `workflow:stopTracking`, `workflow:sync-state`

## 5. Renderer State & Card Rendering

- [x] 5.1 Add `workflowCardStates: Record<string, WorkflowExecutionState>` to `src/stores/chat.ts`
- [x] 5.2 Implement IPC listener for `workflow:status-update` with `sessionKey` filtering
- [x] 5.3 Implement page-load sync: scan messages for `workflow_card` blocks, call `workflow:sync-state`, handle fallback to backend query
- [x] 5.4 Create `src/components/workflow/WorkflowCard.tsx` with status badge, progress bar, step timeline, and artifact links
- [x] 5.5 Create `src/components/workflow/WorkflowExecutionSteps.tsx` step timeline sub-component
- [x] 5.6 Modify `src/pages/Chat/ChatMessage.tsx` to detect `workflow_card` blocks and render `WorkflowCard` with live state
- [x] 5.7 Ensure card re-renders on state update without creating new message bubbles

## 6. Chat Store & Send Flow

- [x] 6.1 Modify `src/stores/chat.ts` `sendMessage` signature to accept `workflowId?: string | null`
- [x] 6.2 Include `workflowId` and `executionId` in Gateway `chat.send` RPC parameters
- [x] 6.3 Modify `src/pages/Chat/index.tsx` `handleSend` to accept and forward `workflowId`
- [x] 6.4 Add concurrent execution guard: reject if 5+ active workflows in current session

## 7. Integration & Polish

- [ ] 7.1 Replace `WorkflowPlaceholder` in `src/pages/Chat/ChatPreviewPanel.tsx` with actual workflow execution visualization (P2, optional)
- [x] 7.2 Add i18n keys for workflow-related UI text (zh, en, ja)
- [x] 7.3 Run `pnpm run typecheck` and fix type errors
- [x] 7.4 Run `pnpm run lint` and fix style issues
- [x] 7.5 Run `pnpm run comms:replay` and `pnpm run comms:compare` (if communication paths touched)
- [x] 7.6 Update `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md` with any implementation deviations
