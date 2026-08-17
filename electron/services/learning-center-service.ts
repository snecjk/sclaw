import { memoryCenterFetchForSession } from './sto-memory-api-fetch';

/**
 * Client-visible learning center routes, proxied 1:1 to memory-center
 * `/api/v1/learning-center/<route>`. Admin routes are deliberately absent —
 * sto-claw only consumes the visibility-filtered client contract.
 */
export const LEARNING_CENTER_CLIENT_ROUTES: ReadonlySet<string> = new Set([
  'domain/page',
  'category/page',
  'tutorial/page',
  'case-template/page',
  'tutorial/detail',
  'case-template/detail',
  'case-template/use',
]);

/**
 * Forward a learning center request body untouched. IDs stay in their original
 * JSON representation (the renderer sends strings), so Snowflake-sized IDs are
 * never routed through a lossy JavaScript number.
 */
export function forwardLearningCenterRequest(
  route: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  return memoryCenterFetchForSession(`/api/v1/learning-center/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}
