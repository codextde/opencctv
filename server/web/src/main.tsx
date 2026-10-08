import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { basePath } from './api';
import './styles/base.css';
import './styles/app.css';
import './styles/pages.css';

// Dev convenience: `?mock=1` / `?mock=0` toggles the preview data, only on localhost.
{
  const m = new URLSearchParams(window.location.search).get('mock');
  if (m !== null && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
    if (m === '1') localStorage.setItem('opencctv.mock', '1');
    else localStorage.removeItem('opencctv.mock');
  }
}

// Normalise the base path early (adds a trailing slash when mounted under a prefix).
basePath();

const favicon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#14B8A6"/><circle cx="16" cy="16" r="8.6" fill="none" stroke="#06201D" stroke-width="2.4"/><circle cx="16" cy="16" r="3.8" fill="#06201D"/></svg>';
const link = document.createElement('link');
link.rel = 'icon';
link.href = 'data:image/svg+xml,' + encodeURIComponent(favicon);
document.head.appendChild(link);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
