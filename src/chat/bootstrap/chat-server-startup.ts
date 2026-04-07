import { logChatStartupBanner } from './chat-startup-banner';
import { performChatStartupSecurityChecks } from './chat-startup-security';
import type { ChatServerStartupConfig } from './chat-startup-types';

export type { ChatServerSecurityConfig, ChatServerStartupConfig } from './chat-startup-types';

export async function startChatServer(config: ChatServerStartupConfig): Promise<void> {
  performChatStartupSecurityChecks(config.security);
  await config.hydrate();

  await new Promise<void>((resolve, reject) => {
    config.server.once('error', reject);
    config.server.listen(config.port, () => {
      logChatStartupBanner(config);
      resolve();
    });
  });
}
