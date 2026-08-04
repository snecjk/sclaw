import type { DataCenterArtifactProvenance } from '@/types/data-center';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';

export interface SendMessageOptions {
  text: string;
  /** Explicit destination used by background/queued sends. Never inferred from current UI state. */
  sessionKey?: string | null;
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
  /** Hidden embed-browser page snapshot for in-app preview chat */
  embedBrowserContext?: import('@/lib/sclaw-browser-embed-context').SclawBrowserEmbedContextBlock | null;
  /** Skill plaza context — UI tag + Gateway defaultPrompt injection */
  skillMeta?: SkillMeta;
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
  /** Preview / external-open URL (workflow previewUrl). */
  filePath?: string;
  /** Download URL (workflow tempUrl). Falls back to filePath when absent. */
  downloadUrl?: string;
  /** Data Center provenance used by the artifact-preview "保存产物" action. */
  artifactProvenance?: DataCenterArtifactProvenance;
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
  /** Local-only: skill plaza tag metadata for user message bubble rendering */
  _skillMeta?: SkillMeta;
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
  /**
   * Owning agent for this session. Required for `claude-task:*` keys which do not
   * embed agentId in the session key (key-derived fallback would wrongly be `main`).
   */
  agentId?: string;
  /** Parent session key when this session was spawned as an OpenClaw subagent. */
  spawnedBy?: string;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  /** Anthropic tool_use / OpenAI arguments；可被后续事件补全 */
  input?: unknown;
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;

  /** True while model switch API is in flight — blocks chat input to prevent
   *  sending before backend has applied the new model. */
  modelSwitching: boolean;
  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;
  /** Frozen sidebar "Recent" order captured on first load; stable until app restart. */
  sidebarRecentOrder: string[];
  /** Task session keys being triggered; stabilizes sidebar order before switchSession/runtime. */
  activatingScheduledSessionAt: Record<string, number>;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  /** Model selected on the new-conversation page (DEFAULT_SESSION_KEY) before sending.
   *  Carried into the real session created by newSession() so the user's choice
   *  is preserved instead of reverting to the global default. */
  pendingNewSessionModel: string | null;
  setPendingNewSessionModel: (model: string | null) => void;

  /** Project id for an empty home draft that has not materialized a session yet.
   *  First send creates the real session and binds it to this project. */
  pendingProjectId: string | null;
  setPendingProjectId: (projectId: string | null) => void;

  // Workflow
  pendingWorkflow: {
    templateId: string;
    templateName: string;
    schema: import('@/types/workflow').WorkflowSchema;
    schemaHash: string;
    workflowId?: string;
    collectedInputs?: Record<string, unknown>;
    /** 工作流启动前用户在输入框 @ 的钉钉收件人（随对话上下文注入，由 Agent 按提示词决定是否发送）。 */
    dingTalkMentions?: import('@/types/dingtalk-mention').DingTalkMention[];
    /** Set to true when the frontend has already inserted a parameter_form inline.
     *  Prevents maybeAppendWorkflowParameterForm from double-injecting. */
    frontendFormInserted?: boolean;
    /** Set after sendWithWorkflow has sent workflowContext to the model via Gateway. */
    modelGuidanceSent?: boolean;
  } | null;
  setPendingWorkflow: (pending: ChatState['pendingWorkflow']) => void;
  /** Drop in-memory pending only; keeps localStorage draft for session restore. */
  clearPendingWorkflowMemory: () => void;
  clearPendingWorkflow: () => void;

  // Actions
  loadSessions: (options?: { force?: boolean }) => Promise<void>;
  switchSession: (key: string) => void;
  /** Jump to the chosen agent's main session (same prefix as sidebar / new chat). */
  switchToAgentMainSession: (agentId: string) => void;
  newSession: (options?: { projectId?: string; materialize?: boolean }) => void;
  deleteSession: (key: string, options?: {
    skipSessionRefresh?: boolean;
    additionalSuppressKeys?: string[];
  }) => Promise<boolean>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean, force?: boolean, sessionKey?: string) => Promise<void>;
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  abortRun: (sessionKey?: string) => Promise<boolean>;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  renameSession: (key: string, newName: string) => void;
  markScheduledSessionActivating: (sessionKey: string) => void;
  clearScheduledSessionActivating: (sessionKey: string) => void;
  /** Clear activating hint only after runtime/activity has taken over sort ordering. */
  releaseScheduledSessionActivating: (sessionKey: string) => void;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;

/** Sidebar-only placeholder for a project "新对话" draft (not persisted until first send). */
export const PROJECT_NEW_CHAT_DRAFT_KEY = 'project-draft:pending';

export function isProjectNewChatDraftKey(sessionKey: string | null | undefined): boolean {
  return (sessionKey ?? '').trim() === PROJECT_NEW_CHAT_DRAFT_KEY;
}
