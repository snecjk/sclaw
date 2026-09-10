export const APP_DEV_FULLSTACK_TEMPLATE_ID = 'site-fullstack';

/**
 * Create-app never offers fullstack, including `pnpm dev`.
 * Existing fullstack workspaces still run if they were created earlier.
 */
export function isAppDevFullstackCreateEnabled(): boolean {
  return false;
}
