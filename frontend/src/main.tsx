import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'COMFYFORGE_UPDATE_READY') {
      window.dispatchEvent(new CustomEvent('comfyforge:update-ready', {
        detail: { version: event.data.version }
      }));
    }
  });

  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW Registered!', reg))
        .catch(err => console.log('SW Reg error:', err));
    } else {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => registrations.forEach(registration => registration.unregister()))
        .catch(err => console.log('SW unregister error:', err));

      if ('caches' in window) {
        caches.keys()
          .then(cacheNames => Promise.all(cacheNames.map(cacheName => caches.delete(cacheName))))
          .catch(err => console.log('Cache cleanup error:', err));
      }
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
