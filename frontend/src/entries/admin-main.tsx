import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from '../admin/pages/AdminPage';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';

const mountNode = document.getElementById('app');

if (mountNode) {
  createRoot(mountNode).render(
    <StrictMode>
      <AdminPage />
    </StrictMode>
  );
}
