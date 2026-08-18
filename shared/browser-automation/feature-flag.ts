/** Feature flag for Browser Automation Platform (Step 1). Disabled in production until explicitly enabled. */

export function isBrowserAutomationEnabled(): boolean {
  const raw = (process.env.STOCLAW_BROWSER_AUTOMATION ?? process.env.VITE_STOCLAW_BROWSER_AUTOMATION ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return process.env.NODE_ENV !== 'production';
}
