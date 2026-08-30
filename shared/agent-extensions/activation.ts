import type {
  SclawActivationDefinition,
  SclawActivationResult,
  SclawExtensionBuildContext,
  SclawExtensionDiagnostic,
} from './types';

const SESSION_ACTIVATION_PREFIX = '__sclaw_activation__:';

export interface SclawActivationEvaluation {
  active: boolean;
  source: 'always' | 'matched' | 'session-cache' | 'unmatched' | 'error';
  reason?: string;
}

export interface CreateSclawActivationEvaluatorInput {
  extensionId: string;
  activations?: readonly SclawActivationDefinition[];
  context: SclawExtensionBuildContext;
  diagnostics: SclawExtensionDiagnostic[];
}

function normalizeResult(
  value: boolean | SclawActivationResult,
): SclawActivationResult {
  return typeof value === 'boolean' ? { active: value } : value;
}

function pushDiagnosticOnce(
  diagnostics: SclawExtensionDiagnostic[],
  diagnostic: SclawExtensionDiagnostic,
): void {
  if (diagnostics.some((item) => (
    item.extensionId === diagnostic.extensionId
    && item.contributionId === diagnostic.contributionId
    && item.code === diagnostic.code
    && item.message === diagnostic.message
  ))) return;
  diagnostics.push(diagnostic);
}

/**
 * Creates a per-build/per-turn evaluator. Repeated references to the same
 * activation execute the matcher once, while session-scoped matches are kept
 * in the existing extension session state.
 */
export function createSclawActivationEvaluator(
  input: CreateSclawActivationEvaluatorInput,
): (activationId?: string) => Promise<SclawActivationEvaluation> {
  const definitions = new Map((input.activations ?? []).map((item) => [item.id, item]));
  const evaluated = new Map<string, Promise<SclawActivationEvaluation>>();

  return async (activationId?: string): Promise<SclawActivationEvaluation> => {
    if (!activationId) return { active: true, source: 'always' };
    const existing = evaluated.get(activationId);
    if (existing) return existing;

    const evaluation = (async (): Promise<SclawActivationEvaluation> => {
      const definition = definitions.get(activationId);
      if (!definition) {
        return { active: false, source: 'error', reason: 'unknown-activation' };
      }

      const stateKey = `${SESSION_ACTIVATION_PREFIX}${activationId}`;
      if (definition.scope === 'session' && input.context.state.session.get<boolean>(stateKey)) {
        input.context.logger.debug('[agent-extension] activation.restored', {
          engine: input.context.engine,
          extensionId: input.extensionId,
          activationId,
          scope: definition.scope,
          source: 'session-cache',
        });
        return { active: true, source: 'session-cache' };
      }

      const startedAt = Date.now();
      try {
        const result = normalizeResult(await definition.match(input.context));
        if (result.active && definition.scope === 'session') {
          input.context.state.session.set(stateKey, true);
        }
        const source = result.active ? 'matched' : 'unmatched';
        input.context.logger.debug('[agent-extension] activation.evaluated', {
          engine: input.context.engine,
          extensionId: input.extensionId,
          activationId,
          scope: definition.scope,
          active: result.active,
          source,
          reason: result.reason,
          promptChars: input.context.userPrompt?.length ?? 0,
          durationMs: Date.now() - startedAt,
        });
        return { active: result.active, source, reason: result.reason };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushDiagnosticOnce(input.diagnostics, {
          extensionId: input.extensionId,
          contributionId: activationId,
          code: 'ACTIVATION_MATCH_FAILED',
          message,
        });
        input.context.logger.warn('[agent-extension] activation.failed', {
          engine: input.context.engine,
          extensionId: input.extensionId,
          activationId,
          scope: definition.scope,
          error: message,
          durationMs: Date.now() - startedAt,
        });
        return { active: false, source: 'error', reason: 'matcher-failed' };
      }
    })();
    evaluated.set(activationId, evaluation);
    return evaluation;
  };
}

export interface KeywordActivationMatcherOptions {
  keywords?: readonly string[];
  patterns?: readonly RegExp[];
  excludePatterns?: readonly RegExp[];
  minimumMatches?: number;
  normalize?: (text: string) => string;
  reason?: string;
}

/** Basic matcher for simple domains; complex business intent should wrap or replace it. */
export function createKeywordActivationMatcher(
  options: KeywordActivationMatcherOptions,
): SclawActivationDefinition['match'] {
  return (context) => {
    const raw = context.userPrompt ?? '';
    const text = options.normalize ? options.normalize(raw) : raw.trim().toLowerCase();
    const matches = (pattern: RegExp): boolean => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    };
    if (!text || options.excludePatterns?.some(matches)) {
      return { active: false };
    }
    const keywordMatches = (options.keywords ?? []).filter(
      (keyword) => text.includes(keyword.toLowerCase()),
    ).length;
    const patternMatches = (options.patterns ?? []).filter(matches).length;
    const active = keywordMatches + patternMatches >= (options.minimumMatches ?? 1);
    return { active, reason: active ? (options.reason ?? 'keyword-match') : undefined };
  };
}
