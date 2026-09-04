import {
  parseBrowserAutomationLevel,
  setBrowserAutomationSettingsLevel,
  type BrowserAutomationLevel,
} from '../../../shared/browser-automation/feature-flag';
import { getSetting } from '../../utils/store';
import {
  ensureStoBrowserAutomationPluginInOpenClaw,
  setStoBrowserAutomationPluginEnabled,
} from '../../utils/openclaw-auth';
import { browserBridgeService } from '../browser-bridge-service';

export async function applyBrowserAutomationLevel(level: BrowserAutomationLevel): Promise<void> {
  setBrowserAutomationSettingsLevel(level);
  if (level === 'off') {
    await setStoBrowserAutomationPluginEnabled(false);
    browserBridgeService.revokeAllTokens();
    return;
  }
  await ensureStoBrowserAutomationPluginInOpenClaw();
}

export async function applyBrowserAutomationLevelFromStore(): Promise<BrowserAutomationLevel> {
  const stored = await getSetting('browserAutomationLevel');
  const level = parseBrowserAutomationLevel(stored) ?? 'dom';
  await applyBrowserAutomationLevel(level);
  return level;
}
