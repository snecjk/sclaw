import { describe, expect, it } from 'vitest';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  parseProjectAgentId,
  resolveProjectAgentId,
} from '../../shared/project-agent';

describe('project agent id', () => {
  const projectId = '123e4567-e89b-12d3-a456-426614174000';

  it('round-trips UUID project ids and dashed base agent ids', () => {
    const agentId = resolveProjectAgentId(projectId, 'ops-agent');

    expect(agentId).toBe('proj-123e4567-e89b-12d3-a456-426614174000--ops-agent');
    expect(parseProjectAgentId(agentId)).toEqual({ projectId, baseAgentId: 'ops-agent' });
    expect(getProjectIdFromProjectAgentId(agentId)).toBe(projectId);
    expect(getBaseAgentIdFromProjectAgentId(agentId)).toBe('ops-agent');
  });

  it('parses legacy UUID project agent ids', () => {
    const legacyId = 'proj-123e4567-e89b-12d3-a456-426614174000-main';

    expect(parseProjectAgentId(legacyId)).toEqual({ projectId, baseAgentId: 'main' });
  });

  it('keeps generated ids within the OpenClaw 64-character limit', () => {
    expect(resolveProjectAgentId(projectId, 'a-very-long-base-agent-identifier')).toHaveLength(64);
  });
});
