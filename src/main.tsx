import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('page-root') ?? document.getElementById('root');

if (!container) {
  throw new Error('[SykaBelajar] React mount element not found. Expected #page-root or #root.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
