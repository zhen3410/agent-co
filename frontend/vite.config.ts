import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = __dirname;
const outputDir = path.resolve(rootDir, '../dist/frontend');

const pageDefinitions = [
  { name: 'chat', virtualEntryId: 'virtual:page-entry-chat', title: 'agent-co chat' },
  { name: 'admin', virtualEntryId: 'virtual:page-entry-admin', title: 'agent-co admin' },
  { name: 'deps-monitor', virtualEntryId: 'virtual:page-entry-deps-monitor', title: 'agent-co deps monitor' },
  { name: 'verbose-logs', virtualEntryId: 'virtual:page-entry-verbose-logs', title: 'agent-co verbose logs' }
] as const;

function createVirtualPageEntryPlugin(): Plugin {
  return {
    name: 'frontend-virtual-page-entries',
    resolveId(id) {
      const page = pageDefinitions.find(candidate => candidate.virtualEntryId === id);
      if (!page) {
        return null;
      }

      return `\0${page.virtualEntryId}`;
    },
    load(id) {
      const page = pageDefinitions.find(candidate => `\0${candidate.virtualEntryId}` === id);
      if (!page) {
        return null;
      }

      return [
        "import { createElement } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "const mountNode = document.getElementById('app');",
        'if (mountNode) {',
        '  const root = createRoot(mountNode);',
        `  root.render(createElement('main', { 'data-page': '${page.name}' }, '${page.title} shell'));`,
        '}'
      ].join('\n');
    }
  };
}

function createHtmlPageEmitPlugin(): Plugin {
  return {
    name: 'frontend-emit-mpa-html-pages',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entryChunks = new Map(
        Object.values(bundle)
          .filter(item => item.type === 'chunk' && item.isEntry)
          .map(item => [item.name, item.fileName])
      );

      for (const page of pageDefinitions) {
        const entryFileName = entryChunks.get(page.name);
        if (!entryFileName) {
          this.error(`missing entry output for page: ${page.name}`);
        }

        this.emitFile({
          type: 'asset',
          fileName: `${page.name}.html`,
          source: [
            '<!doctype html>',
            '<html lang="en">',
            '  <head>',
            '    <meta charset="UTF-8" />',
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            `    <title>${page.title}</title>`,
            '  </head>',
            '  <body>',
            '    <div id="app"></div>',
            `    <script type="module" src="./${entryFileName}"></script>`,
            '  </body>',
            '</html>'
          ].join('\n')
        });
      }
    }
  };
}

export default defineConfig({
  root: rootDir,
  plugins: [react(), createVirtualPageEntryPlugin(), createHtmlPageEmitPlugin()],
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: Object.fromEntries(pageDefinitions.map(page => [page.name, page.virtualEntryId]))
    }
  }
});
