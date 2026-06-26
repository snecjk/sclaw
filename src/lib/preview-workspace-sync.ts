import {
  hasToolWorkspaceHints,
  parseToolWorkspaceHints,
} from '../../shared/tool-workspace-hints';
import { syncPreviewSessionContext } from '@/lib/host-api';

/** Push tool-result workspace hints to the main process for file preview resolution. */
export async function syncPreviewContextFromToolResult(
  sessionKey: string,
  content: unknown,
): Promise<void> {
  const hints = parseToolWorkspaceHints(content);
  if (!hasToolWorkspaceHints(hints)) return;
  await syncPreviewSessionContext(sessionKey, {
    cwd: hints.cwd ?? null,
    outputDir: hints.outputDir ?? null,
    runDir: hints.runDir ?? null,
  });
}
