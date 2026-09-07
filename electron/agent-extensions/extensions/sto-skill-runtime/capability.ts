import type { SclawAgentEngine, SclawAgentSessionMode } from '../../../../shared/agent-extensions';
import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';

export interface RuntimeSkillSearchRequest {
  sessionKey: string;
  runId?: string;
  agentId?: string;
  engine: SclawAgentEngine;
  mode: SclawAgentSessionMode;
  query: string;
  limit?: number;
}

export interface RuntimeSkillSearchResponse {
  query: string;
  items: Array<{
    slug: string;
    name: string;
    description: string;
    score: number;
    reasons: string[];
    sourceHash: string;
    skillRoot: string;
    skillMdPath: string;
  }>;
  totalEnabled: number;
  degraded: boolean;
}

export interface RuntimeSkillReadRequest {
  sessionKey: string;
  runId?: string;
  agentId?: string;
  slug: string;
  sourceHash: string;
  requestedPath: string;
}

export interface UserSkillAsset {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface SaveUserSkillRequest {
  slug?: string;
  skillMd: string;
  name?: string;
  description?: string;
  assets?: UserSkillAsset[];
  force?: boolean;
}

export interface SaveUserSkillResponse {
  ok: true;
  slug: string;
  scope: 'user';
  userCode: string;
  storePath: string;
  source: 'local';
}

export class StoSkillRuntimePortError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StoSkillRuntimePortError';
  }
}

export interface StoSkillRuntimePort {
  search(input: RuntimeSkillSearchRequest): Promise<RuntimeSkillSearchResponse>;
  recordRead(input: RuntimeSkillReadRequest): Promise<{ slug: string; recorded: true }>;
  save(input: SaveUserSkillRequest): Promise<SaveUserSkillResponse>;
  scheduleOrphanImport(reason: string): Promise<void>;
}

export const STO_SKILL_RUNTIME_CAPABILITY =
  createSclawCapabilityToken<StoSkillRuntimePort>('sto.skill-runtime');
