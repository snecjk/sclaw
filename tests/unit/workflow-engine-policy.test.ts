import { describe, expect, it } from 'vitest';
import { resolveWorkflowEngineSelection } from '@/hooks/use-workflow-engine-policy';
import {
  getAgentEnginePolicyOptionLabel,
  normalizeAgentEnginePolicy,
} from '@/stores/agent-engine-policy';

describe('workflow engine policy', () => {
  const policy = normalizeAgentEnginePolicy({
    engines: [
      { code: 'claude', name: 'Claude Server', order: 30 },
      { code: 'pi', name: 'PI Server', order: 10 },
      { code: 'openclaw', name: 'OpenClaw Server', order: 20 },
    ],
    defaultEngine: 'pi',
  });

  it('preserves server order and uses the shared SAgent PI label', () => {
    expect(policy.engines.map((engine) => engine.code)).toEqual(['pi', 'openclaw', 'claude']);
    expect(policy.engines.map(getAgentEnginePolicyOptionLabel)).toEqual([
      'SAgent', 'OpenClaw Server', 'Claude Server',
    ]);
  });

  it('uses the policy default and falls back to the first enabled engine', () => {
    expect(resolveWorkflowEngineSelection(undefined, policy.engines, policy.defaultEngine)).toBe('pi');
    expect(resolveWorkflowEngineSelection('claude', policy.engines, policy.defaultEngine)).toBe('claude');
    expect(resolveWorkflowEngineSelection('pi', policy.engines, policy.defaultEngine, new Set(['pi'])))
      .toBe('openclaw');
  });
});
