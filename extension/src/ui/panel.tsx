import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import XRayApp from './XRayApp';
import './styles.css';

const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <XRayApp mode="panel" tabId={inspectedTabId} />
  </StrictMode>
);
