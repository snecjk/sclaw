import { describe, expect, it } from 'vitest';
import { chatEngineRequiresGateway } from '@/hooks/use-chat-input-bindings';

describe('chatEngineRequiresGateway', () => {
  it('gates only OpenClaw on Gateway readiness', () => {
    expect(chatEngineRequiresGateway('openclaw')).toBe(true);
    expect(chatEngineRequiresGateway('claude')).toBe(false);
    expect(chatEngineRequiresGateway('pi')).toBe(false);
    expect(chatEngineRequiresGateway(undefined)).toBe(false);
  });
});
