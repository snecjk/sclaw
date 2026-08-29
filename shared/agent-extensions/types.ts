import type { Static, TObject } from 'typebox';

export type SclawAgentEngine = 'claude' | 'pi';
export type SclawAgentSessionMode = 'interactive' | 'scheduled';
export type SclawNativeContributionMode = 'augment' | 'replace';

export interface SclawExtensionLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface SclawCapabilityToken<T> {
  readonly id: string;
  readonly __value?: T;
}

export interface SclawCapabilityResolver {
  has<T>(token: SclawCapabilityToken<T>): boolean;
  get<T>(token: SclawCapabilityToken<T>): T | undefined;
  require<T>(token: SclawCapabilityToken<T>): T;
}

export interface SclawStateScope {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  getOrCreate<T>(key: string, create: () => T): T;
  delete(key: string): void;
  clear(): void;
}

export interface SclawExtensionState {
  readonly session: SclawStateScope;
  readonly turn: SclawStateScope;
  toolCall(toolCallId: string): SclawStateScope;
}

export interface SclawExtensionContext {
  engine: SclawAgentEngine;
  sessionKey: string;
  mode: SclawAgentSessionMode;
  cwd?: string;
  allowedRoots?: readonly string[];
  agentId?: string;
  runId?: string;
  capabilities: SclawCapabilityResolver;
  state: SclawExtensionState;
  logger: SclawExtensionLogger;
}

export interface SclawExtensionBuildContext extends SclawExtensionContext {
  userPrompt?: string;
}

export interface SclawToolExecutionContext extends SclawExtensionBuildContext {
  toolCallId: string;
  signal?: AbortSignal;
}

export type SclawToolPolicyContext = SclawExtensionBuildContext;

export interface SclawContributionSelector {
  engines?: readonly SclawAgentEngine[];
}

export interface SclawToolSuccess<T = unknown> {
  success: true;
  type: string;
  domain: string;
  data: T;
  message?: string;
}

export interface SclawToolFailure {
  success: false;
  type: 'sto_tool_error';
  domain: string;
  message?: string;
  error: {
    code: string;
    message: string;
  };
}

export type SclawToolOutcome<T = unknown> = SclawToolSuccess<T> | SclawToolFailure;

export interface SclawToolDefinition<
  TParameters extends TObject = TObject,
  TOutput = unknown,
> extends SclawContributionSelector {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  execute(
    params: Static<TParameters>,
    context: SclawToolExecutionContext,
  ): Promise<SclawToolOutcome<TOutput>>;
}

export interface SclawBeforeToolEvent {
  rawToolName: string;
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface SclawAfterToolEvent extends SclawBeforeToolEvent {
  content?: unknown;
  details?: unknown;
  result?: unknown;
  isError: boolean;
}

export type SclawBeforeToolDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string; terminate?: boolean }
  | { action: 'patch'; input: Record<string, unknown> };

export interface SclawToolPolicy extends SclawContributionSelector {
  id: string;
  beforeTool?(
    event: SclawBeforeToolEvent,
    context: SclawToolPolicyContext,
  ): Promise<SclawBeforeToolDecision | void> | SclawBeforeToolDecision | void;
  afterTool?(
    event: SclawAfterToolEvent,
    context: SclawToolPolicyContext,
  ): Promise<void> | void;
}

export interface SclawPromptContribution extends SclawContributionSelector {
  id: string;
  text?: string;
  build?(
    context: SclawExtensionBuildContext,
  ): Promise<string | undefined> | string | undefined;
}

export interface SclawAgentExtensionDefinition extends SclawContributionSelector {
  id: string;
  version: string;
  requiredCapabilities?: readonly SclawCapabilityToken<unknown>[];
  tools?: readonly SclawToolDefinition[];
  policies?: readonly SclawToolPolicy[];
  prompts?: readonly SclawPromptContribution[];
}

export interface SclawExtensionDiagnostic {
  extensionId: string;
  code: string;
  message: string;
  contributionId?: string;
}

export function supportsEngine(
  contribution: SclawContributionSelector,
  engine: SclawAgentEngine,
): boolean {
  return !contribution.engines || contribution.engines.includes(engine);
}

export function normalizeSclawToolName(toolName: string): string {
  const segments = toolName.trim().split('__');
  return (segments[segments.length - 1] || toolName).trim().toLowerCase();
}
