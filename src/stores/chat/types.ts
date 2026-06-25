import type { WorkflowExecutionState } from '@/types/workflow';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export interface SendMessageOptions {
  text: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>;
  targetAgentId?: string | null;
  dingTalkMentions?: DingTalkMention[];
  workflowId?: string | null;
  runId?: string | null;
  /** Hidden workflow schema context injected into the user message for AI guidance */
  workflowContext?: WorkflowContextBlock | null;
}

/** Hidden context block describing a workflow for AI parameter guidance */
export interface WorkflowContextBlock {
  type: 'workflow_context';
  templateId: string;
  templateName: string;
  schemaHash: string;
  confirmSteps?: string[];
  fields: Array<{
    key: string;
    label: string;
    component: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: unknown;
  }>;
}

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult' | 'workflow_card' | 'parameter_form' | 'workflow_context';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
  /** Workflow execution card reference */
  runId?: string;
  /** Shared by workflow_card and workflow_context blocks */
  templateName?: string;
  /** Parameter form block fields */
  formId?: string;
  formConfig?: import('@/types/user-form').UserFormConfig;
  formContext?: {
    source: 'workflow' | 'tool' | 'skill';
    sourceId: string;
    schemaHash?: string;
  };
  /** Workflow context block fields (hidden from user, used for AI guidance) */
  templateId?: string;
  schemaHash?: string;
  fields?: Array<{
    key: string;
    label: string;
    component: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: unknown;
  }>;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
  updatedAt?: number;
  engineType?: 'openclaw' | 'claude';
  /** Parent session key when this session was spawned as an OpenClaw subagent. */
  spawnedBy?: string;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface DailyTokenQuotaStatus {
  allowed?: boolean;
  usedToday?: number;
  limit?: number;
  checkedAt: string;
}

export interface SessionRuntimeState {
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingToolImages: AttachedFileMeta[];
  error: string | null;
  updatedAt: number;
}

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  /** True while model switch API is in flight — blocks chat input to prevent
   *  sending before backend has applied the new model. */
  modelSwitching: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  /** Last successful daily token quota check result. */
  dailyTokenQuotaStatus: DailyTokenQuotaStatus | null;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
  /** Runtime state cache per session key so background runs survive session switches. */
  runtimeBySessionKey: Record<string, SessionRuntimeState>;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  // Workflow
  workflowCardStates: Record<string, WorkflowExecutionState>;
  setWorkflowCardState: (runId: string, state: WorkflowExecutionState) => void;
  pendingWorkflow: {
    templateId: string;
    templateName: string;
    schema: import('@/types/workflow').WorkflowSchema;
    schemaHash: string;
    workflowId?: string;
    collectedInputs?: Record<string, unknown>;
    /** Set to true when the frontend has already inserted a parameter_form inline.
     *  Prevents maybeAppendWorkflowParameterForm from double-injecting. */
    frontendFormInserted?: boolean;
    /** Set after sendWithWorkflow has sent workflowContext to the model via Gateway. */
    modelGuidanceSent?: boolean;
  } | null;
  setPendingWorkflow: (pending: ChatState['pendingWorkflow']) => void;
  clearPendingWorkflow: () => void;

  // Actions
  loadSessions: () => Promise<void>;
  switchSession: (key: string) => void;
  /** Jump to the chosen agent's main session (same prefix as sidebar / new chat). */
  switchToAgentMainSession: (agentId: string) => void;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean) => Promise<void>;
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  renameSession: (key: string, newName: string) => void;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
