import { describe, expect, it } from 'vitest';
import {
  getBaseAgentIdFromProjectAgentId,
  getProjectIdFromProjectAgentId,
  parseProjectAgentId,
  resolveProjectAgentId,
} from '../../shared/project-agent';

const PROJECT_UUID = '4df7afd4-2d12-43b3-97e0-87383f953341';

describe('project-agent id helpers', () => {
  it('builds and parses UUID project ids with simple base agents', () => {
    const agentId = resolveProjectAgentId(PROJECT_UUID, 'main');
    expect(agentId).toBe(`proj-${PROJECT_UUID}-main`);
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: PROJECT_UUID,
      baseAgentId: 'main',
    });
    expect(getProjectIdFromProjectAgentId(agentId)).toBe(PROJECT_UUID);
    expect(getBaseAgentIdFromProjectAgentId(agentId)).toBe('main');
  });

  it('parses UUID project ids when base agent id contains dashes', () => {
    const agentId = resolveProjectAgentId(PROJECT_UUID, 'custom-agent');
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: PROJECT_UUID,
      baseAgentId: 'custom-agent',
    });
  });

  it('parses simple project ids without dashes', () => {
    const agentId = resolveProjectAgentId('myproject', 'main');
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: 'myproject',
      baseAgentId: 'main',
    });
  });

  it('parses non-uuid project ids with dashes using the last separator', () => {
    const agentId = resolveProjectAgentId('my-project', 'main');
    expect(parseProjectAgentId(agentId)).toEqual({
      projectId: 'my-project',
      baseAgentId: 'main',
    });
  });

  it('can disambiguate dashed base agents when known base ids are provided', () => {
    const agentId = resolveProjectAgentId('my-project', 'custom-agent');
    expect(parseProjectAgentId(agentId, ['custom-agent', 'main'])).toEqual({
      projectId: 'my-project',
      baseAgentId: 'custom-agent',
    });
  });

  it('returns null for non project agent ids', () => {
    expect(parseProjectAgentId('main')).toBeNull();
    expect(parseProjectAgentId('agent-main')).toBeNull();
  });
});
