import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';

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

export class StoUserSkillPortError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StoUserSkillPortError';
    this.code = code;
  }
}

export interface StoUserSkillPort {
  save(input: SaveUserSkillRequest): Promise<SaveUserSkillResponse>;
  scheduleOrphanImport(reason: string): Promise<void>;
}

export const STO_USER_SKILL_CAPABILITY =
  createSclawCapabilityToken<StoUserSkillPort>('sto.user-skill');
