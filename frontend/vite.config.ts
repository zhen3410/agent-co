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
        chat: path.resolve(rootDir, 'index.html'),
        admin: path.resolve(rootDir, 'index.html'),
        depsMonitor: path.resolve(rootDir, 'index.html'),
        verboseLogs: path.resolve(rootDir, 'index.html')
      }
    }
  }
});
