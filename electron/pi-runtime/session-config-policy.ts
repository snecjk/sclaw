import { createHash } from 'node:crypto';
import type { PiSessionConfig } from '../../shared/pi-runtime-protocol';

/** Stable session identity. Per-turn media is excluded; native Skill selection is not. */
export function piSessionConfigurationKey(config: PiSessionConfig): string {
  return JSON.stringify({
    cwd: config.cwd,
    agentDir: config.agentDir,
    projectTrusted: config.projectTrusted === true,
    provider: config.model.provider,
    model: config.model.model,
    baseUrl: config.model.baseUrl ?? '',
    apiProtocol: config.model.apiProtocol ?? '',
    headers: config.model.headers ?? {},
    credentialRevision: config.model.apiKey
      ? createHash('sha256').update(config.model.apiKey).digest('hex')
      : '',
    sessionMode: config.sessionMode ?? 'interactive',
    skillRoots: config.skillRoots ?? [],
    skillSetHash: config.skillSetHash ?? '',
    systemPrompt: config.systemPrompt ?? '',
  });
}
