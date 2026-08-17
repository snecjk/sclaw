import type { WebContents } from 'electron';
import type {
  BrowserAutomationActPayload,
  BrowserAutomationActResult,
} from '../../../shared/browser-automation/types';
import { BROWSER_AUTOMATION_MAX_ELEMENTS } from '../../../shared/browser-automation/types';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';
import type { BrowserAutomationCdpSession } from './cdp-session';

interface ResolvedInputTarget {
  found: boolean;
  ref?: string;
  stableKey?: string;
  centerX?: number;
  centerY?: number;
  value?: string;
  editable?: boolean;
  error?: string;
}

interface ReadTargetValueResult {
  found: boolean;
  value?: string;
  stableKey?: string;
  error?: string;
}

const CDP_MODIFIER_ALT = 1;
const CDP_MODIFIER_CTRL = 2;
const CDP_MODIFIER_META = 4;
const CDP_MODIFIER_SHIFT = 8;

const KEY_DEFS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 36 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  A: { key: 'A', code: 'KeyA', keyCode: 65 },
};

function buildObserveBootstrap(): string {
  return buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS);
}

function serializePayload(payload: BrowserAutomationActPayload): string {
  return JSON.stringify({
    ref: payload.ref,
    stableKey: payload.stableKey,
    name: payload.name,
    value: payload.value,
  });
}

export async function resolveTargetForInput(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<ResolvedInputTarget> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.resolveTargetForInput(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as ResolvedInputTarget;
  return result ?? { found: false, error: 'resolveTargetForInput returned null' };
}

export async function readTargetInputValue(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<ReadTargetValueResult> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.readTargetInputValue(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as ReadTargetValueResult;
  return result ?? { found: false, error: 'readTargetInputValue returned null' };
}

function valuesMatch(actual: string, expected: string): boolean {
  const normalizedActual = actual.trim();
  const normalizedExpected = expected.trim();
  if (!normalizedExpected) return normalizedActual.length === 0;
  return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected);
}

async function dispatchMouseClick(
  cdp: BrowserAutomationCdpSession,
  x: number,
  y: number,
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    clickCount: 0,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function dispatchKey(
  cdp: BrowserAutomationCdpSession,
  type: 'keyDown' | 'keyUp' | 'char',
  key: string,
  modifiers = 0,
): Promise<void> {
  const def = KEY_DEFS[key] ?? {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
  };
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers,
    text: type === 'char' ? def.key : undefined,
  });
}

async function selectAll(cdp: BrowserAutomationCdpSession): Promise<void> {
  const selectAllModifier = process.platform === 'darwin' ? CDP_MODIFIER_META : CDP_MODIFIER_CTRL;
  const selectKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await dispatchKey(cdp, 'keyDown', selectKey, selectAllModifier);
  await dispatchKey(cdp, 'keyDown', 'a', selectAllModifier);
  await dispatchKey(cdp, 'keyUp', 'a', selectAllModifier);
  await dispatchKey(cdp, 'keyUp', selectKey, selectAllModifier);
}

async function clearField(cdp: BrowserAutomationCdpSession): Promise<void> {
  await selectAll(cdp);
  await dispatchKey(cdp, 'keyDown', 'Backspace');
  await dispatchKey(cdp, 'keyUp', 'Backspace');
}

export async function typeTextViaCdp(
  cdp: BrowserAutomationCdpSession,
  text: string,
  options?: { clearFirst?: boolean },
): Promise<void> {
  if (options?.clearFirst !== false) {
    await clearField(cdp);
  }
  if (text) {
    await cdp.send('Input.insertText', { text });
  }
}

export async function pressKeyViaCdp(
  cdp: BrowserAutomationCdpSession,
  key: string,
): Promise<void> {
  const normalized = key.trim();
  if (!normalized) throw new Error('key is required');
  if (normalized === 'Space') {
    await dispatchKey(cdp, 'keyDown', 'Space');
    await dispatchKey(cdp, 'keyUp', 'Space');
    return;
  }
  await dispatchKey(cdp, 'keyDown', normalized);
  await dispatchKey(cdp, 'keyUp', normalized);
}

async function nativeFillTarget(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<{ success: boolean; value?: string; stableKey?: string; error?: string }> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.nativeFillTarget(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as {
    success?: boolean;
    value?: string;
    stableKey?: string;
    error?: string;
  };
  return {
    success: Boolean(result?.success),
    value: result?.value,
    stableKey: result?.stableKey,
    error: result?.error,
  };
}

export async function actFillOrType(
  input: {
    cdp: BrowserAutomationCdpSession;
    executeJavaScript: (script: string) => Promise<unknown>;
    payload: BrowserAutomationActPayload;
  },
): Promise<BrowserAutomationActResult> {
  const expected = input.payload.value ?? '';
  const resolved = await resolveTargetForInput(input.executeJavaScript, input.payload);
  if (!resolved.found || resolved.centerX == null || resolved.centerY == null) {
    return {
      success: false,
      action: 'fill',
      error: resolved.error ?? 'Element not found',
    };
  }

  await dispatchMouseClick(input.cdp, resolved.centerX, resolved.centerY);
  await typeTextViaCdp(input.cdp, expected, { clearFirst: true });

  let read = await readTargetInputValue(input.executeJavaScript, input.payload);
  if (read.found && valuesMatch(read.value ?? '', expected)) {
    return {
      success: true,
      action: 'fill',
      ref: resolved.ref ?? input.payload.ref,
      stableKey: read.stableKey ?? resolved.stableKey ?? input.payload.stableKey,
      error: undefined,
    };
  }

  const fallback = await nativeFillTarget(input.executeJavaScript, input.payload);
  read = await readTargetInputValue(input.executeJavaScript, input.payload);
  const actual = read.value ?? fallback.value ?? '';
  if (fallback.success && valuesMatch(actual, expected)) {
    return {
      success: true,
      action: 'fill',
      ref: resolved.ref ?? input.payload.ref,
      stableKey: fallback.stableKey ?? resolved.stableKey ?? input.payload.stableKey,
    };
  }

  return {
    success: false,
    action: 'fill',
    ref: resolved.ref ?? input.payload.ref,
    stableKey: resolved.stableKey ?? input.payload.stableKey,
    error: expected
      ? `Typed value did not stick (expected "${expected}", got "${actual}")`
      : 'Unable to clear or fill the target field',
  };
}

export async function actPressKey(
  input: {
    cdp: BrowserAutomationCdpSession;
    executeJavaScript: (script: string) => Promise<unknown>;
    payload: BrowserAutomationActPayload;
  },
): Promise<BrowserAutomationActResult> {
  const key = input.payload.key?.trim();
  if (!key) {
    return { success: false, action: 'press', error: 'key is required' };
  }

  const resolved = await resolveTargetForInput(input.executeJavaScript, input.payload);
  if (resolved.found && resolved.centerX != null && resolved.centerY != null) {
    await dispatchMouseClick(input.cdp, resolved.centerX, resolved.centerY);
  }

  await pressKeyViaCdp(input.cdp, key);
  return {
    success: true,
    action: 'press',
    ref: resolved.ref ?? input.payload.ref,
    stableKey: resolved.stableKey ?? input.payload.stableKey,
  };
}

export function getOrCreateCdpSession(
  webContents: WebContents,
  cache: Map<number, BrowserAutomationCdpSession>,
): BrowserAutomationCdpSession {
  let cdp = cache.get(webContents.id);
  if (!cdp) {
    cdp = new BrowserAutomationCdpSession(webContents);
    cache.set(webContents.id, cdp);
  }
  return cdp;
}

export { valuesMatch };
