import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { syncApplicationMenuFromStore } from '../../main/menu';
import { syncPreventSystemSleepSettingFromStore } from '../../main/prevent-sleep';
import {
  applyNativeAppearancePreference,
  isThemePreference,
  normalizeThemePreference,
  syncNativeAppearanceFromStore,
} from '../../main/appearance';
import { syncProxyConfigToOpenClaw } from '../../utils/openclaw-proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import { appUpdater } from '../../main/updater';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function patchTouchesPreventSystemSleep(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'preventSystemSleep');
}

function patchTouchesLanguage(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'language');
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const settings = await getAllSettings();
    sendJson(res, 200, { ...settings, theme: normalizeThemePreference(settings.theme) });
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      if (Object.prototype.hasOwnProperty.call(patch, 'channelSessionIdleHours')) {
        const raw = Number(patch.channelSessionIdleHours);
        patch.channelSessionIdleHours = Number.isFinite(raw)
          ? Math.min(168, Math.max(1, Math.floor(raw)))
          : 24;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'theme') && !isThemePreference(patch.theme)) {
        sendJson(res, 400, { success: false, error: 'Invalid theme preference' });
        return true;
      }
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      if (patchTouchesLaunchAtStartup(patch)) {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (patchTouchesPreventSystemSleep(patch)) {
        await syncPreventSystemSleepSettingFromStore();
      }
      if (patchTouchesLanguage(patch)) {
        await syncApplicationMenuFromStore();
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
        applyNativeAppearancePreference(patch.theme as AppSettings['theme']);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'autoCheckUpdate')) {
        await appUpdater.syncPeriodicCheckFromSettings(patch.autoCheckUpdate === true);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: unknown }>(req);
      if (key === 'theme' && !isThemePreference(body.value)) {
        sendJson(res, 400, { success: false, error: 'Invalid theme preference' });
        return true;
      }
      await setSetting(key, body.value as AppSettings[keyof AppSettings]);
      if (
        key === 'proxyEnabled' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      if (key === 'launchAtStartup') {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (key === 'preventSystemSleep') {
        await syncPreventSystemSleepSettingFromStore();
      }
      if (key === 'language') {
        await syncApplicationMenuFromStore();
      }
      if (key === 'theme') {
        applyNativeAppearancePreference(body.value as AppSettings['theme']);
      }
      if (key === 'autoCheckUpdate') {
        await appUpdater.syncPeriodicCheckFromSettings(body.value === true);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      await handleProxySettingsChange(ctx);
      await syncLaunchAtStartupSettingFromStore();
      await syncPreventSystemSleepSettingFromStore();
      await syncApplicationMenuFromStore();
      await syncNativeAppearanceFromStore();
      const settings = await getAllSettings();
      await appUpdater.syncPeriodicCheckFromSettings(settings.autoCheckUpdate === true);
      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
