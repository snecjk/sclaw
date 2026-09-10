import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RuntimeBootstrapShell } from './components/RuntimeBootstrapShell';
import { bootstrapInstalledPlugins } from './sclaw/bootstrap';
import './theme/theme.css';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing root element');
}

const root = createRoot(container);

root.render(<RuntimeBootstrapShell />);

void bootstrapInstalledPlugins()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    root.render(
      <RuntimeBootstrapShell
        error={error instanceof Error ? error.message : '应用基础能力启动失败'}
      />,
    );
  });
