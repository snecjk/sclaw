import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SsoExchangeError, SsoExchangeLoading } from './components/SsoAuthShell';
import { bootstrapAuthFromUrl } from './lib/auth-token';
import { checkAndRedirectToLogin, hasAuthorizationCode, isLoggedIn } from './lib/sso';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing root element');
}

const root = createRoot(container);

if (hasAuthorizationCode() && !isLoggedIn()) {
  root.render(<SsoExchangeLoading />);
}

void bootstrapAuthFromUrl().then((result) => {
  if (result.status === 'exchange_failed') {
    root.render(<SsoExchangeError message={result.message} />);
    return;
  }

  if (checkAndRedirectToLogin()) return;

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
