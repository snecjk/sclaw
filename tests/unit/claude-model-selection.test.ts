import { describe, expect, it } from 'vitest';
import type { ProviderAccount } from '../../electron/shared/providers/types';
import { selectAvailableClaudeModel } from '../../electron/engines/claude-model-selection';

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'sto',
    vendorId: 'sto',
    label: 'STO',
    authMode: 'api_key',
    enabled: true,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectAvailableClaudeModel', () => {
  it('maps a bare model id to its qualified current catalog entry', () => {
    const result = selectAvailableClaudeModel({
      accounts: [account({ metadata: { customModels: ['dashscope/qwen3.6-plus'] } })],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'qwen3.6-plus',
    });

    expect(result).toEqual({
      model: 'dashscope/qwen3.6-plus',
      accountId: 'sto',
      fallbackApplied: true,
    });
  });

  it('keeps an exact qualified model that still exists', () => {
    const result = selectAvailableClaudeModel({
      accounts: [account({ metadata: { customModels: ['dashscope/qwen3.6-plus'] } })],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'dashscope/qwen3.6-plus',
    });

    expect(result?.model).toBe('dashscope/qwen3.6-plus');
    expect(result?.fallbackApplied).toBe(false);
  });

  it('uses the configured current fallback when the requested model was delisted', () => {
    const result = selectAvailableClaudeModel({
      accounts: [account({
        model: 'dashscope/qwen3.5-plus',
        metadata: { customModels: ['dashscope/qwen3.5-plus', 'deepseek/deepseek-v3'] },
      })],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'dashscope/qwen3.6-plus',
    });

    expect(result).toEqual({
      model: 'dashscope/qwen3.5-plus',
      accountId: 'sto',
      fallbackApplied: true,
    });
  });

  it('uses the first live catalog model if no configured fallback remains', () => {
    const result = selectAvailableClaudeModel({
      accounts: [account({ metadata: { customModels: ['deepseek/deepseek-v3'] } })],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'dashscope/qwen3.6-plus',
    });

    expect(result?.model).toBe('deepseek/deepseek-v3');
    expect(result?.fallbackApplied).toBe(true);
  });

  it('falls through to another ready account when the STO catalog is unavailable', () => {
    const result = selectAvailableClaudeModel({
      accounts: [
        account({ metadata: { customModels: [] } }),
        account({
          id: 'custom-ready',
          vendorId: 'custom',
          isDefault: false,
          model: 'provider/fallback-model',
        }),
      ],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'qwen3.6-plus',
    });

    expect(result).toEqual({
      model: 'provider/fallback-model',
      accountId: 'custom-ready',
      fallbackApplied: true,
    });
  });

  it('returns null when no provider has an available model', () => {
    const result = selectAvailableClaudeModel({
      accounts: [account({ metadata: { customModels: [] } })],
      defaultAccountId: 'sto',
      requestedAccountId: 'sto',
      requestedModel: 'qwen3.6-plus',
    });

    expect(result).toBeNull();
  });
});
