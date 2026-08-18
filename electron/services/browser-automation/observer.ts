import type {
  BrowserAutomationPageObservation,
} from '../../../shared/browser-automation/types';
import { BROWSER_AUTOMATION_MAX_ELEMENTS } from '../../../shared/browser-automation/types';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';
import type { BrowserAutomationCdpSession } from './cdp-session';

interface RawObservation {
  url?: string;
  title?: string;
  timestamp?: number;
  elements?: BrowserAutomationPageObservation['elements'];
  fingerprint?: string;
}

export async function observePage(
  sessionId: string,
  cdp: BrowserAutomationCdpSession,
  executeJavaScript: (script: string) => Promise<unknown>,
  networkState: { networkState: 'idle' | 'loading'; pendingRequests: number },
): Promise<BrowserAutomationPageObservation> {
  const raw = await executeJavaScript(
    buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS),
  ) as RawObservation;

  const elements = Array.isArray(raw?.elements)
    ? raw.elements.slice(0, BROWSER_AUTOMATION_MAX_ELEMENTS)
    : [];

  let url = typeof raw?.url === 'string' ? raw.url : '';
  let title = typeof raw?.title === 'string' ? raw.title : '';

  if (!url && !cdp.isDestroyed) {
    url = cdp.rawWebContents.getURL();
    title = cdp.rawWebContents.getTitle();
  }

  return {
    sessionId,
    url,
    title,
    timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
    elements,
    fingerprint: typeof raw?.fingerprint === 'string' ? raw.fingerprint : '',
    networkState: networkState.networkState,
    pendingRequests: networkState.pendingRequests,
  };
}
