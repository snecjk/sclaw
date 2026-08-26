import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureStoTokenFromUrl } from './lib/auth-token';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing root element');
}

const root = createRoot(container);

// 托管应用由外层宿主完成身份认证，只接收宿主注入的 stoToken，不自行跳转 SSO。
captureStoTokenFromUrl();
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
