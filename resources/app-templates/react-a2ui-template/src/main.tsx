import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureStoTokenFromUrl } from './lib/auth-token';
import './index.css';

captureStoTokenFromUrl();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing root element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
