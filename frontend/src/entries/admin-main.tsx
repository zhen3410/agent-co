import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

const mountNode = document.getElementById('app');
if (mountNode) {
  createRoot(mountNode).render(createElement('main', { 'data-page': 'admin' }, 'admin page shell'));
}
