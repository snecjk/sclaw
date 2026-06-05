/**
 * Cloud Cron Task Type Definitions
 * Shared types for cloud-scheduled task execution
 */

/**
 * Cloud task schedule format (simplified for external API)
 */
export interface CloudCronSchedule {
  /** Cron expression or interval description */
  expr: string;
  /** Optional timezone */
  tz?: string;
}

/**
 * Cloud agent reference (minimal info for task binding)
 */
export interface CloudAgentRef {
  id: string;
  name: string;
  model: string;
  status: 'online' | 'error' | 'offline';
}

/**
 * Cloud cron job entity (stored on external cloud service)
 */
export interface CloudCronJob {
  id: string;
  name: string;
  message: string;
  schedule: CloudCronSchedule;
  agentId: string;
  agentName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CloudCronJobLastRun;
  nextRun?: string;
}

/**
 * Cloud task last run info
 */
export interface CloudCronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

/**
 * Input for creating a cloud cron job
 */
export interface CloudCronJobCreateInput {
  name: string;
  message: string;
  schedule: string;
  agentId: string;
  enabled?: boolean;
}

/**
 * Input for updating a cloud cron job
 */
export interface CloudCronJobUpdateInput {
  name?: string;
  message?: string;
  schedule?: string;
  agentId?: string;
  enabled?: boolean;
}

/**
 * Cloud task execution result
 */
export interface CloudTaskResult {
  id: string;
  taskId: string;
  runId: string;
  /** Cloud agent ID that executed this task (used for session routing) */
  agentId?: string;
  status: 'success' | 'failure' | 'timeout';
  startedAt: string;
  completedAt: string;
  duration: number;
  output?: {
    message: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
  };
  error?: {
    code: string;
    message: string;
  };
  agentVersion?: string;
  model?: string;
}

/**
 * Paginated result list response
 */
export interface CloudTaskResultList {
  results: CloudTaskResult[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Execution location for a cron job
 */
export type ExecutionLocation = 'local' | 'cloud';

/**
 * Unified cron job view (local or cloud)
 */
export interface UnifiedCronJob {
  id: string;
  name: string;
  message: string;
  schedule: string;
  enabled: boolean;
  executionLocation: ExecutionLocation;
  agentId?: string;
  agentName?: string;
  createdAt: string;
  updatedAt: string;
  lastRun?: CloudCronJobLastRun;
  nextRun?: string;
  cloudStatus?: 'synced' | 'sync-pending' | 'error';
}
