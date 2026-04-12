import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DepsMonitorPage } from '../ops/pages/DepsMonitorPage';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';

const mountNode = document.getElementById('app');

if (mountNode) {
  createRoot(mountNode).render(
    <StrictMode>
      <DepsMonitorPage />
    </StrictMode>
  );
}
