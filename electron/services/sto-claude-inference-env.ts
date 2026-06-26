import type { ProviderAccount } from '../shared/providers/types';
import { getAuthState } from '../utils/auth-store';
import { logger } from '../utils/logger';
import { getApiKey } from '../utils/secure-storage';
import { resolveStrategy } from './sto-sk-strategy';
import { getUserSk } from './user-sk-service';

/**
 * Anthropic SDK origin for STO Claude Agent — same llmgateway host as OpenClaw.
 * OpenClaw stores `${origin}/v1` on ProviderAccount.baseUrl; SDK appends `/v1/messages`.
 */
export async function resolveStoClaudeAnthropicBaseUrl(
  account?: Pick<ProviderAccount, 'baseUrl'> | null,
): Promise<string | null> {
  const fromAccount = account?.baseUrl?.trim();
  if (fromAccount) {
    return fromAccount.replace(/\/v1\/?$/, '');
  }

  const { user } = await getAuthState();
  const strategy = await resolveStrategy(user);
  if (!strategy) return null;
  return strategy.getSupplierDomain();
}

/** User SK (Bearer sk-...) — same credential OpenClaw uses for STO inference. */
export async function resolveStoClaudeApiKey(accountId?: string): Promise<string | null> {
  if (accountId) {
    const cached = await getApiKey(accountId);
    if (cached?.trim()) return cached.trim();
  }
  return getUserSk();
}

export async function applyStoClaudeInferenceEnv(
  base: NodeJS.ProcessEnv,
  account: ProviderAccount,
): Promise<void> {
  const [apiKey, baseUrl] = await Promise.all([
    resolveStoClaudeApiKey(account.id),
    resolveStoClaudeAnthropicBaseUrl(account),
  ]);

  if (apiKey && baseUrl) {
    base.ANTHROPIC_BASE_URL = baseUrl;
    base.ANTHROPIC_API_KEY = apiKey;
    base.ANTHROPIC_AUTH_TOKEN = apiKey;
    logger.info(`[claude-env] STO provider: base_url=${baseUrl}`);
    return;
  }

  logger.warn('[claude-env] STO provider but no SK or llmgateway domain available');
}
