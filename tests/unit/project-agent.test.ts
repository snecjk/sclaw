import { describe, expect, it } from 'vitest';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  parseProjectAgentId,
  resolveProjectAgentId,
} from '../../shared/project-agent';

const PROJECT_UUID = '4df7afd4-2d12-43b3-97e0-87383f953341';

describe('project-agent id helpers', () => {
  it('round-trips UUID project ids and dashed base-agent ids', () => {
    const agentId = resolveProjectAgentId(PROJECT_UUID, 'custom-agent');
    expect(agentId).toBe(`proj-${PROJECT_UUID}--custom-agent`);
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: PROJECT_UUID,
      baseAgentId: 'custom-agent',
    });
    expect(getProjectIdFromProjectAgentId(agentId)).toBe(PROJECT_UUID);
    expect(getBaseAgentIdFromProjectAgentId(agentId)).toBe('custom-agent');
  });

  it('round-trips dashed non-UUID project ids without ambiguity', () => {
    const agentId = resolveProjectAgentId('my-project', 'custom-agent');
    expect(agentId).toBe('proj-my-project--custom-agent');
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: 'my-project',
      baseAgentId: 'custom-agent',
    });
  });

  it('continues to parse legacy UUID-based project-agent ids', () => {
    expect(parseProjectAgentId(`proj-${PROJECT_UUID}-custom-agent`)).toEqual({
      projectId: PROJECT_UUID,
      baseAgentId: 'custom-agent',
    });
  });

  it('disambiguates legacy arbitrary ids using known base-agent ids', () => {
    expect(parseProjectAgentId('proj-my-project-custom-agent', ['custom-agent', 'main'])).toEqual({
      projectId: 'my-project',
      baseAgentId: 'custom-agent',
    });
  });

  it('keeps generated ids within the OpenClaw 64-character limit', () => {
    expect(resolveProjectAgentId('project', 'a'.repeat(100))).toHaveLength(64);
  });

  it('returns null for non-project agent ids', () => {
    expect(parseProjectAgentId('main')).toBeNull();
    expect(parseProjectAgentId('agent-main')).toBeNull();
  });
});
