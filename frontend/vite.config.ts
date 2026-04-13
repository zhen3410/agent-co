import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = __dirname;

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  build: {
    outDir: path.resolve(rootDir, '../dist/frontend'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        home: path.resolve(rootDir, 'index.html'),
        chat: path.resolve(rootDir, 'chat.html'),
        admin: path.resolve(rootDir, 'admin.html'),
        'deps-monitor': path.resolve(rootDir, 'deps-monitor.html'),
        'verbose-logs': path.resolve(rootDir, 'verbose-logs.html')
      }
    }
  }
});
