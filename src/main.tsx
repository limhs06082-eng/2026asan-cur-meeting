import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SessionProvider } from './lib/session';
import './styles.css';
import { USE_EMULATOR, auth } from './lib/firebase';

// 개발(에뮬레이터) 전용 점검 도구
if (USE_EMULATOR) void import('./lib/repo').then((repo) => Object.assign(window, { __repo: repo, __auth: auth }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ErrorBoundary>
  </StrictMode>,
);
