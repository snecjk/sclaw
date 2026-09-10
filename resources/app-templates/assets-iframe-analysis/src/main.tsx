import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapSsoAuth } from '@sto/sclaw-plugin-sso-auth';
import App from './App';
import { initializeIframeTokenBridge } from './sclaw/iframe-token-bridge';
import './styles.css';

const container = document.getElementById('root');

if (!container) throw new Error('Missing root element');

const root = createRoot(container);

async function start(): Promise<void> {
  const config = window.__STO_SSO_AUTH_CONFIG__;
  if (config?.runtimeMode === 'local') {
    await bootstrapSsoAuth({ config, fetch: window.fetch.bind(window) });
  } else {
    await initializeIframeTokenBridge();
  }
  root.render(<StrictMode><App /></StrictMode>);
}

void start().catch((error) => {
  root.render(<div className="startup-error" role="alert">{error instanceof Error ? error.message : '应用身份初始化失败'}</div>);
});
