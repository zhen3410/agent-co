import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HomePage } from '../home/pages/HomePage';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';
import '../home/styles/home-page.css';

const mountNode = document.getElementById('app');

if (mountNode) {
  createRoot(mountNode).render(
    <StrictMode>
      <HomePage />
    </StrictMode>
  );
}
