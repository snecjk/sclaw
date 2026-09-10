export interface IframeApplicationConfigInput {
  runtimeConfig?: { applicationId?: unknown };
  buildApplicationId?: unknown;
}

function asApplicationId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveIframeApplicationId(input: IframeApplicationConfigInput): string {
  const runtimeId = asApplicationId(input.runtimeConfig?.applicationId);
  if (runtimeId) return runtimeId;
  const buildId = asApplicationId(input.buildApplicationId);
  if (buildId) return buildId;
  throw new Error('请配置 window.__SCLAW_APP_CONFIG__.applicationId 或 VITE_SCLAW_APPLICATION_ID');
}

export function getIframeApplicationId(): string {
  return resolveIframeApplicationId({
    runtimeConfig: window.__SCLAW_APP_CONFIG__,
    buildApplicationId: import.meta.env.VITE_SCLAW_APPLICATION_ID,
  });
}
