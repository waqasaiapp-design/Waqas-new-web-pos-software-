import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[POS Recovery] Prevented unhandled promise rejection crash:', event.reason);
    event.preventDefault();
  });

  window.addEventListener('error', (event) => {
    console.warn('[POS Recovery] Caught global runtime error:', event.message || event.error);
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);


