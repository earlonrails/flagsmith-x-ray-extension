import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import XRayApp from './XRayApp';
import './styles.css';

function PopupRoot() {
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id !== undefined) {
        setTabId(tabs[0].id);
      }
    });
  }, []);

  return <XRayApp mode="popup" tabId={tabId} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupRoot />
  </StrictMode>
);
