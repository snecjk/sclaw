import { describe, expect, it } from 'vitest';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  parseProjectAgentId,
  resolveProjectAgentId,
} from '../../shared/project-agent';

describe('project agent ids', () => {
  it('round-trips UUID project ids and dashed base agent ids', () => {
    const projectId = '123e4567-e89b-42d3-a456-426614174000';
    const agentId = resolveProjectAgentId(projectId, 'base-agent');

    expect(parseProjectAgentId(agentId)).toEqual({
      projectId,
      baseAgentId: 'base-agent',
    });
    expect(getProjectIdFromProjectAgentId(agentId)).toBe(projectId);
    expect(getBaseAgentIdFromProjectAgentId(agentId)).toBe('base-agent');
  });

  it('continues to parse legacy UUID-based project agent ids', () => {
    const legacy = 'proj-123e4567-e89b-42d3-a456-426614174000-main';
    expect(parseProjectAgentId(legacy)).toEqual({
      projectId: '123e4567-e89b-42d3-a456-426614174000',
      baseAgentId: 'main',
    });
  });

  it('keeps generated ids within the OpenClaw 64-character limit', () => {
    expect(resolveProjectAgentId('project', 'a'.repeat(100))).toHaveLength(64);
  });
});
