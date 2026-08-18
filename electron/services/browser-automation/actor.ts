import type {
  BrowserAutomationActPayload,
  BrowserAutomationActResult,
} from '../../../shared/browser-automation/types';
import {
  buildObserveScript,
  BROWSER_AUTOMATION_VALIDATE_SCRIPT,
} from '../../../shared/browser-automation/observe-script';
import { BROWSER_AUTOMATION_MAX_ELEMENTS } from '../../../shared/browser-automation/types';
import type { BrowserAutomationValidatorResult, BrowserAutomationValidatorSpec } from '../../../shared/browser-automation/types';

function buildActScript(payload: BrowserAutomationActPayload): string {
  const serialized = JSON.stringify(payload);
  return `${buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS)}; window.__stoBrowserAutomation.act(${serialized})`;
}

export async function actOnPage(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<BrowserAutomationActResult> {
  const result = await executeJavaScript(buildActScript(payload)) as {
    success?: boolean;
    action?: BrowserAutomationActPayload['action'];
    ref?: string;
    stableKey?: string;
    error?: string;
  };

  return {
    success: Boolean(result?.success),
    action: payload.action,
    ref: result?.ref ?? payload.ref,
    stableKey: result?.stableKey ?? payload.stableKey,
    error: result?.error,
  };
}

export async function validateOnPage(
  executeJavaScript: (script: string) => Promise<unknown>,
  spec: BrowserAutomationValidatorSpec,
): Promise<BrowserAutomationValidatorResult> {
  const script = `(${BROWSER_AUTOMATION_VALIDATE_SCRIPT})(${JSON.stringify(spec)})`;
  const result = await executeJavaScript(script) as BrowserAutomationValidatorResult;
  return {
    passed: Boolean(result?.passed),
    type: result?.type ?? spec.type,
    message: result?.message ?? (result?.passed ? 'ok' : 'failed'),
  };
}
