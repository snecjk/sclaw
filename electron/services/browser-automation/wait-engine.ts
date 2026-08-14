import type { WebContents } from 'electron';
import type { BrowserAutomationWaitCondition } from '../../../shared/browser-automation/types';
import {
  BROWSER_AUTOMATION_NETWORK_IDLE_MS,
  BROWSER_AUTOMATION_MAX_ELEMENTS,
} from '../../../shared/browser-automation/types';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface WaitEngineDeps {
  webContents: WebContents;
  executeJavaScript: (script: string) => Promise<unknown>;
  getPendingRequestCount: () => number;
}

export async function waitForCondition(
  deps: WaitEngineDeps,
  condition: BrowserAutomationWaitCondition,
): Promise<{ success: boolean; message: string }> {
  const timeoutMs = condition.timeoutMs ?? 30_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (deps.webContents.isDestroyed()) {
      return { success: false, message: 'WebContents destroyed during wait' };
    }

    if (condition.type === 'timeout') {
      await sleep(Math.min(timeoutMs, 1000));
      return { success: true, message: 'Timeout elapsed' };
    }

    if (condition.type === 'url') {
      const current = deps.webContents.getURL();
      if (condition.urlPattern && new RegExp(condition.urlPattern).test(current)) {
        return { success: true, message: `URL matched: ${current}` };
      }
    }

    if (condition.type === 'navigation') {
      if (!deps.webContents.isLoading()) {
        return { success: true, message: 'Navigation completed' };
      }
    }

    if (condition.type === 'networkIdle') {
      if (!deps.webContents.isLoading() && deps.getPendingRequestCount() === 0) {
        await sleep(BROWSER_AUTOMATION_NETWORK_IDLE_MS);
        if (!deps.webContents.isLoading() && deps.getPendingRequestCount() === 0) {
          return { success: true, message: 'Network idle' };
        }
      }
    }

    if (condition.type === 'selector' || condition.stableKey) {
      const observation = await deps.executeJavaScript(
        buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS),
      ) as { elements?: Array<{ stableKey?: string; selector?: string }> };
      const elements = Array.isArray(observation?.elements) ? observation.elements : [];
      if (condition.stableKey && elements.some((el) => el.stableKey === condition.stableKey)) {
        return { success: true, message: `stableKey found: ${condition.stableKey}` };
      }
      if (condition.selector) {
        const found = await deps.executeJavaScript(
          `Boolean(document.querySelector(${JSON.stringify(condition.selector)}))`,
        );
        if (found) return { success: true, message: `Selector found: ${condition.selector}` };
      }
    }

    await sleep(50);
  }

  return { success: false, message: `Wait timed out after ${timeoutMs}ms (${condition.type})` };
}

export async function waitAfterAction(
  deps: WaitEngineDeps,
  options?: { source?: 'embed' | 'managed'; action?: string },
): Promise<void> {
  if (options?.source === 'embed' && options.action === 'click') {
    await waitForCondition(deps, { type: 'navigation', timeoutMs: 3000 });
    return;
  }
  await waitForCondition(deps, { type: 'networkIdle', timeoutMs: 15_000 });
}
