import {
  parseBrowserAutomationLevel,
  setBrowserAutomationSettingsLevel,
  type BrowserAutomationLevel,
} from '../../../shared/browser-automation/feature-flag';
import { getSetting } from '../../utils/store';
import {
  ensureStoBrowserAutomationPluginInOpenClaw,
  ensureStoBrowserBridgePluginInOpenClaw,
  setStoBrowserAutomationPluginEnabled,
  setStoBrowserBridgePluginEnabled,
} from '../../utils/openclaw-auth';
import { browserBridgeService } from '../browser-bridge-service';

export async function applyBrowserAutomationLevel(level: BrowserAutomationLevel): Promise<void> {
  setBrowserAutomationSettingsLevel(level);
  if (level === 'off') {
    await setStoBrowserAutomationPluginEnabled(false);
    await setStoBrowserBridgePluginEnabled(false);
    browserBridgeService.setAutoConnectEnabled(false);
    browserBridgeService.revokeAllTokens();
    return;
  }
  await ensureStoBrowserAutomationPluginInOpenClaw();
  await ensureStoBrowserBridgePluginInOpenClaw();
  browserBridgeService.setAutoConnectEnabled(true);
}

export async function applyBrowserAutomationLevelFromStore(): Promise<BrowserAutomationLevel> {
  const stored = await getSetting('browserAutomationLevel');
  const level = parseBrowserAutomationLevel(stored) ?? 'dom';
  await applyBrowserAutomationLevel(level);
  return level;
}
