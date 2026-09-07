import { requestMemoryCenter } from '../memory-center-http-client';

const SKILL_ROUTING_CARDS_UPSERT_PATH = '/agent/v1/skill-routing/cards/upsert';
const SKILL_ROUTING_SEARCH_PATH = '/agent/v1/skill-routing/search';
const LOG_SCOPE = '[skill-routing][remote]';

export interface SkillRoutingCardInput {
  slug: string;
  sourceHash: string;
  name?: string;
  description?: string;
  triggers?: string[];
  negativeTriggers?: string[];
  engines?: Array<'claude' | 'pi'>;
  modes?: Array<'interactive' | 'scheduled'>;
  agentIds?: string[];
  enabled?: boolean;
}

export interface SkillRoutingSearchParams {
  query: string;
  engine: 'claude' | 'pi';
  agentId?: string;
  mode: 'interactive' | 'scheduled';
  candidateK?: number;
  topK?: number;
}

export interface SkillRoutingSearchResult {
  items: Array<{
    slug: string;
    score: number;
    sourceHash?: string;
    reasons?: string[];
  }>;
  degraded?: boolean;
}

export class SkillRoutingRemoteService {
  async upsertCards(
    cards: SkillRoutingCardInput[],
  ): Promise<{ accepted: number; indexedVariants: number; keywordIndexed: boolean }> {
    return requestMemoryCenter(SKILL_ROUTING_CARDS_UPSERT_PATH, {
      method: 'POST',
      body: JSON.stringify({ cards }),
      timeoutMs: 60_000,
    }, LOG_SCOPE);
  }

  async search(params: SkillRoutingSearchParams): Promise<SkillRoutingSearchResult> {
    return requestMemoryCenter(SKILL_ROUTING_SEARCH_PATH, {
      method: 'POST',
      body: JSON.stringify(params),
      timeoutMs: 30_000,
    }, LOG_SCOPE);
  }
}

export const skillRoutingRemoteService = new SkillRoutingRemoteService();
