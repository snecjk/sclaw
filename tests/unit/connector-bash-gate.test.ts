import { describe, expect, it } from 'vitest';

import {
  evaluateConnectorBashCommand,
  evaluateConnectorToolCall,
  findGatedBinaryInCommand,
} from '../../shared/connectors/bash-gate';

describe('connector bash gate', () => {
  it('detects dws in direct and discovery commands', () => {
    expect(findGatedBinaryInCommand('dws contact search --name 李峥')).toBe('dws');
    expect(findGatedBinaryInCommand('which dws')).toBe('dws');
    expect(findGatedBinaryInCommand('find /usr/local -name "dws"')).toBe('dws');
  });

  it('blocks dws when allowlist is empty', () => {
    const decision = evaluateConnectorBashCommand('dws contact search --name 李峥', []);
    expect(decision.blocked).toBe(true);
    if (decision.blocked) {
      expect(decision.reason).toContain('未连接');
      expect(decision.reason).toContain('请勿');
    }
  });

  it('allows dws when allowlist includes dws', () => {
    const decision = evaluateConnectorBashCommand('dws auth status', [
      { connectorId: 'conn-dingtalk', allowBinary: 'dws', denyArgs: ['upgrade', 'install'] },
    ]);
    expect(decision.blocked).toBe(false);
  });

  it('blocks exec tool calls via evaluateConnectorToolCall', () => {
    const decision = evaluateConnectorToolCall(
      'exec',
      { command: 'dws contact search --name 李峥' },
      [],
    );
    expect(decision.blocked).toBe(true);
  });

  it('ignores unrelated shell commands', () => {
    const decision = evaluateConnectorToolCall(
      'exec',
      { command: 'openclaw --help' },
      [],
    );
    expect(decision.blocked).toBe(false);
  });

  it('gates only binaries from the provided catalog set', () => {
    expect(findGatedBinaryInCommand('acme-cli status', ['acme-cli'])).toBe('acme-cli');
    expect(findGatedBinaryInCommand('dws auth status', ['acme-cli'])).toBeNull();
    const blocked = evaluateConnectorBashCommand('acme-cli status', [], {
      gatedBinaries: ['acme-cli'],
    });
    expect(blocked.blocked).toBe(true);
  });
});
