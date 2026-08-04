import { describe, expect, it } from 'vitest';

import { parseManagedCliAuthSpec } from '../../shared/connectors/parse-auth-spec';
import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import {
  QPATH_CONNECTOR_AGENT,
  QPATH_CONNECTOR_RUNTIME,
} from '../../shared/connectors/qpath-connector-config';
import { resolveManagedCliAuthMode } from '../../shared/connectors/resolve-auth-mode';
import { resolveManagedCliInstallStrategy } from '../../shared/connectors/resolve-install-strategy';
import { resolveConnectorAgentSkill } from '../../shared/connectors/resolve-agent-skill';
import {
  extractSkillRevisionFromFilename,
  shouldUpdateSkillRevision,
} from '../../shared/connectors/skill-revision';

describe('QPath as new-product connector config', () => {
  it('resolves shell_script install from canonical runtime', () => {
    const install = parseManagedCliInstallSpec(QPATH_CONNECTOR_RUNTIME);
    expect(resolveManagedCliInstallStrategy(install, { binary: 'qpath' })).toBe(
      'shell_script',
    );
    expect(install.unix).toContain('qpath-cli');
    expect(install.binDir).toBe('~/.sto/qpath-cli/bin');
  });

  it('resolves open_url auth from canonical runtime', () => {
    const auth = parseManagedCliAuthSpec(QPATH_CONNECTOR_RUNTIME);
    expect(
      resolveManagedCliAuthMode({
        binary: 'qpath',
        auth,
      }),
    ).toEqual({ mode: 'open_url' });
    expect(auth?.ui).toBe('open_url');
    expect(auth?.openIn).toBe('embedded');
    expect(auth?.loginUrlPattern).toBeTruthy();
    expect(auth?.authExpiredPattern).toBeTruthy();
    expect(auth?.status).toEqual(['qpath', 'status']);
    expect(auth?.logout).toEqual(['qpath', 'logout']);
  });

  it('resolves package skill from canonical agent', () => {
    const skill = resolveConnectorAgentSkill(QPATH_CONNECTOR_AGENT);
    expect(skill?.slug).toBe('qpath-cli-commands');
    expect(skill?.source).toBe('package');
    expect(skill?.packageUrl).toContain('qpath-cli-skill');
  });
});

describe('skill revision helpers', () => {
  it('detects updates and extracts revision from filename', () => {
    expect(shouldUpdateSkillRevision(null, 'abc1234')).toBe(true);
    expect(shouldUpdateSkillRevision('abc1234', 'abc1234')).toBe(false);
    expect(
      extractSkillRevisionFromFilename('qpath-cli-skill-main-deadbeef.tar.gz'),
    ).toBe('deadbeef');
  });
});
