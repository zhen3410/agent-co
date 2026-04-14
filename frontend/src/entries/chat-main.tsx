import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadInitialChatAuthStatus } from '../chat/bootstrap/chat-bootstrap';
import { ChatPage } from '../chat/pages/ChatPage';
import { ThemeProvider } from '../shared/theme/theme';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';

const mountNode = document.getElementById('app');

if (mountNode) {
  const root = createRoot(mountNode);

  void (async () => {
    const authStatus = await loadInitialChatAuthStatus({ authStatusPath: '/api/auth-status' });

    root.render(
      <StrictMode>
        <ThemeProvider>
          <ChatPage initialAuthStatus={authStatus} />
        </ThemeProvider>
      </StrictMode>
    );
  })();
}
