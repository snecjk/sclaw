/** Browser Automation Platform (BAP) — shared types for Step 1. */

export type BrowserAutomationSessionSource = 'embed' | 'managed';

export type BrowserAutomationAction =
  | 'click'
  | 'fill'
  | 'select'
  | 'navigate'
  | 'scroll'
  | 'press';

export type BrowserAutomationRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PAUSED'
  | 'WAITING_HUMAN';

export type BrowserAutomationStepStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'VALIDATING';

export interface BrowserAutomationBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAutomationElementRef {
  /** Compact ref for LLM, e.g. @e3 — valid for current observation only. */
  ref: string;
  /** Stable across observations within a session (selector hash). */
  stableKey: string;
  role: string;
  name: string;
  tag: string;
  selector: string;
  clickable: boolean;
  editable: boolean;
  value?: string;
  states: string[];
  boundingBox: BrowserAutomationBoundingBox;
}

export interface BrowserAutomationPageObservation {
  sessionId: string;
  url: string;
  title: string;
  timestamp: number;
  elements: BrowserAutomationElementRef[];
  fingerprint: string;
  networkState: 'idle' | 'loading';
  pendingRequests: number;
}

export interface BrowserAutomationSession {
  sessionId: string;
  source: BrowserAutomationSessionSource;
  embedRuntimeId?: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  automationPinned: boolean;
}

export interface BrowserAutomationActPayload {
  ref?: string;
  stableKey?: string;
  name?: string;
  action: BrowserAutomationAction;
  value?: string;
  url?: string;
  key?: string;
  scrollY?: number;
}

export interface BrowserAutomationWaitCondition {
  type: 'networkIdle' | 'url' | 'selector' | 'timeout' | 'navigation';
  urlPattern?: string;
  selector?: string;
  stableKey?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationValidatorSpec {
  type: 'url' | 'title' | 'elementExists' | 'elementCount' | 'elementText' | 'networkIdle';
  pattern?: string;
  stableKey?: string;
  ref?: string;
  name?: string;
  role?: string;
  minCount?: number;
  maxCount?: number;
  expectedText?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationValidatorResult {
  passed: boolean;
  type: string;
  message: string;
}

export interface BrowserAutomationActResult {
  success: boolean;
  action: BrowserAutomationAction;
  ref?: string;
  stableKey?: string;
  error?: string;
  observation?: BrowserAutomationPageObservation;
}

export const BROWSER_AUTOMATION_COMMAND_TIMEOUT_MS = 120_000;
export const BROWSER_AUTOMATION_SESSION_IDLE_MS = 30 * 60 * 1000;
export const BROWSER_AUTOMATION_NETWORK_IDLE_MS = 800;
export const BROWSER_AUTOMATION_MAX_ELEMENTS = 120;
