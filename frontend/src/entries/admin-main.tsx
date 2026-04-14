import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from '../admin/app/AdminApp';
import { ThemeProvider } from '../shared/theme/theme';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';

const mountNode = document.getElementById('app');

if (mountNode) {
  createRoot(mountNode).render(
    <StrictMode>
      <ThemeProvider>
        <AdminApp initialPathname={window.location.pathname} />
      </ThemeProvider>
    </StrictMode>
  );
}
