/**
 * Scheduled Task Types (STO Scheduled Tasks API)
 */

export interface ScheduledTask {
  id: number;
  ownerUserId: string;
  name: string;
  taskType: string;
  description: string;
  cronExpr: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  notifyMode: string | null;
  siteCode: string | null;
  siteName: string | null;
  dingdingId: string | null;
  dingdingGroupId: string | null;
  dingdingGroupName: string | null;
  ossObjectKey: string | null;
  dialogSessionKey: string | null;
  openclawGatewayUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskCreateInput {
  name: string;
  cronExpr: string;
  description?: string;
  taskType?: string;
  notifyMode?: string;
  siteCode?: string;
  siteName?: string;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  dialogSessionKey?: string;
  openclawGatewayUrl?: string;
}

export interface ScheduledTaskUpdateInput {
  taskId: number;
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
  enabled?: boolean;
}
