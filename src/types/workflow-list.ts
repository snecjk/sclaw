export type WorkflowCoverKey = 'cover-1' | 'cover-2' | 'cover-3' | 'cover-4' | 'cover-5';

export type WorkflowMineListKind = 'published' | 'draft';

export interface WorkflowCardItem {
  id: string;
  name: string;
  listKind: WorkflowMineListKind;
  enabled: boolean;
  description: string;
  coverKey: WorkflowCoverKey;
  flow: string[];
  templateId?: string | null;
  neverRun?: boolean;
}

export interface OfficialWorkflowCard {
  id: string;
  name: string;
  category: string;
  description: string;
  flow: string[];
  coverKey: WorkflowCoverKey;
}
