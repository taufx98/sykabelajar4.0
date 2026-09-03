import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { startCacheAuthLifecycle } from './lib/cacheAuthLifecycle';
import './index.css';

startCacheAuthLifecycle();

const container = document.getElementById('page-root') ?? document.getElementById('root');

if (!container) {
  throw new Error('[SykaBelajar] React mount element not found. Expected #page-root or #root.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
