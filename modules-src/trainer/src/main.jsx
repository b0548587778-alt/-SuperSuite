import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
// ערכת הצבעים של SuperSuite — אחרי Tailwind כדי לגבור עליו (PLAN.md 6.4)
import './theme.css';
import './lib/storage.js';
import { registerSW } from 'virtual:pwa-register';

// Register service worker for offline support + auto-update
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
