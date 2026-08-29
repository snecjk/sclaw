import { isAbsolute, resolve } from 'node:path';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { SclawExtensionBuildContext } from '../../../../shared/agent-extensions';
import {
  isPiToolPathAllowed,
  piBashViolatesScheduledPolicy,
} from '../../../pi-runtime/path-policy';

const PATH_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls']);

export function buildClawScheduledPathGuard(
  context: SclawExtensionBuildContext,
): InlineExtension | readonly InlineExtension[] {
  const roots = (context.allowedRoots ?? []).filter((root) => root.trim().length > 0);
  if (context.mode !== 'scheduled' || roots.length === 0) return [];

  return {
    name: 'sclaw-scheduled-path-guard',
    factory(pi) {
      pi.on('tool_call', async (event) => {
        const input = event.input as Record<string, unknown>;
        if (event.toolName === 'bash') {
          if (piBashViolatesScheduledPolicy(String(input.command ?? ''), roots)) {
            context.logger.warn('[claw-scheduled-path-guard] tool blocked', {
              toolName: event.toolName,
              reason: 'scheduled-bash-policy',
              commandPreview: String(input.command ?? '').slice(0, 300),
            });
            return {
              block: true,
              reason: 'Scheduled Pi task command is outside the configured workspace/artifact roots',
            };
          }
          return undefined;
        }

        if (!PATH_TOOL_NAMES.has(event.toolName)) return undefined;
        const requested = typeof input.path === 'string' && input.path.trim() ? input.path : roots[0];
        if (!requested) return { block: true, reason: 'Scheduled Pi task has no configured workspace' };
        const absolute = isAbsolute(requested) ? requested : resolve(roots[0], requested);
        if (!(await isPiToolPathAllowed(absolute, roots))) {
          context.logger.warn('[claw-scheduled-path-guard] tool blocked', {
            toolName: event.toolName,
            reason: 'scheduled-path-policy',
            requestedPath: requested,
          });
          return {
            block: true,
            reason: `Scheduled Pi task path is outside the configured roots: ${requested}`,
          };
        }
        return undefined;
      });
    },
  };
}
