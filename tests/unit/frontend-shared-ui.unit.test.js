const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();

function resolveExistingFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve module path: ${basePath}`);
}

function loadTsModule(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const resolvedPath = resolveExistingFile(absolutePath);

  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: resolvedPath
  });

  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);

  const localRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const childBasePath = path.resolve(path.dirname(resolvedPath), specifier);
      const childRelativePath = path.relative(rootDir, childBasePath);
      return loadTsModule(childRelativePath);
    }

    return require(specifier);
  };

  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function render(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props));
}

function findTokenReferences(text) {
  return new Set(Array.from(text.matchAll(/--[a-z0-9-]+/gi), (match) => match[0]));
}

function findClassNames(text) {
  const result = new Set();
  const regex = /className\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  let match = regex.exec(text);
  while (match) {
    const raw = match[1] ?? match[2] ?? '';
    for (const className of raw.split(/\s+/).filter(Boolean)) {
      result.add(className);
    }
    match = regex.exec(text);
  }
  return result;
}

function findCssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm');
  return css.match(regex)?.[1] ?? null;
}

test('shared primitives render semantic HTML elements', () => {
  const { Button } = loadTsModule('frontend/src/shared/ui/Button.tsx');
  const { Input } = loadTsModule('frontend/src/shared/ui/Input.tsx');
  const { Card } = loadTsModule('frontend/src/shared/ui/Card.tsx');
  const { Surface } = loadTsModule('frontend/src/shared/ui/Surface.tsx');
  const { Table } = loadTsModule('frontend/src/shared/ui/Table.tsx');

  const buttonHtml = render(Button, { children: 'Save' });
  assert.match(buttonHtml, /^<button[^>]*>Save<\/button>$/);

  const inputHtml = render(Input, { id: 'name', label: 'Name', hint: 'Required' });
  assert.match(inputHtml, /<label[^>]*for="name"/);
  assert.match(inputHtml, /<input[^>]*id="name"/);

  const cardHtml = render(Card, { title: 'Title', children: React.createElement('p', null, 'Body') });
  assert.match(cardHtml, /^<article\b/);
  assert.match(cardHtml, /<header\b/);

  const surfaceHtml = render(Surface, { children: 'Panel' });
  assert.match(surfaceHtml, /^<section\b/);
  assert.match(surfaceHtml, /data-ui="surface"/);

  const tableHtml = render(Table, {
    columns: [{ key: 'name', header: 'Name', render: (row) => row.name }],
    rows: [{ name: 'Alice' }],
    getRowKey: (row) => row.name,
    caption: 'Users'
  });
  assert.match(tableHtml, /<table\b/);
  assert.match(tableHtml, /<caption[^>]*>Users<\/caption>/);
  assert.match(tableHtml, /<thead\b/);
  assert.match(tableHtml, /<tbody\b/);
});

test('loading/error/empty primitives compose with shared actions and spinner behavior', () => {
  const { Button } = loadTsModule('frontend/src/shared/ui/Button.tsx');
  const { EmptyState } = loadTsModule('frontend/src/shared/ui/EmptyState.tsx');
  const { ErrorState } = loadTsModule('frontend/src/shared/ui/ErrorState.tsx');
  const { Spinner } = loadTsModule('frontend/src/shared/ui/Spinner.tsx');
  const ui = loadTsModule('frontend/src/shared/ui/index.ts');
  const baseCss = readFile('frontend/src/shared/styles/base.css');

  const action = React.createElement(Button, { children: 'Retry' });

  const emptyHtml = render(EmptyState, {
    title: 'No items',
    description: 'Create one to continue',
    action
  });
  assert.match(emptyHtml, /^<section\b/);
  assert.match(emptyHtml, /Retry<\/button>/);

  const errorHtml = render(ErrorState, {
    message: 'Request failed',
    action
  });
  assert.match(errorHtml, /role="alert"/);
  assert.match(errorHtml, /Retry<\/button>/);

  const spinnerHtml = render(Spinner, { label: 'Loading rows' });
  assert.match(spinnerHtml, /role="status"/);
  assert.match(spinnerHtml, /Loading rows/);
  assert.match(spinnerHtml, /spin/);
  assert.match(baseCss, /@keyframes\s+spin\s*\{/);

  assert.equal(typeof ui.Button, 'function');
  assert.equal(typeof ui.EmptyState, 'function');
  assert.equal(typeof ui.ErrorState, 'function');
  assert.equal(typeof ui.Spinner, 'function');
});

test('shared layouts keep stable data attributes for composition', () => {
  const { AppShell } = loadTsModule('frontend/src/shared/layouts/AppShell.tsx');
  const { ToolPageLayout } = loadTsModule('frontend/src/shared/layouts/ToolPageLayout.tsx');

  const appShellHtml = render(AppShell, { title: 'Workbench', children: 'Body' });
  assert.match(appShellHtml, /data-layout="app-shell"/);
  assert.match(appShellHtml, /data-layout="app-shell-header"/);
  assert.match(appShellHtml, /data-layout="app-shell-main"/);

  const toolPageHtml = render(ToolPageLayout, {
    appTitle: 'Workbench',
    pageTitle: 'Tool',
    description: 'Overview',
    sidebar: React.createElement('div', null, 'Sidebar'),
    children: React.createElement('div', null, 'Content')
  });
  assert.match(toolPageHtml, /data-layout="tool-page"/);
  assert.match(toolPageHtml, /data-layout="tool-page-sidebar"/);
  assert.match(toolPageHtml, /data-layout="tool-page-content"/);
});

test('shared primitives use deterministic ids and keep foundation CSS scope', () => {
  const inputSource = readFile('frontend/src/shared/ui/Input.tsx');
  const baseCss = readFile('frontend/src/shared/styles/base.css');

  assert.doesNotMatch(inputSource, /Math\.random\(/);
  assert.match(inputSource, /\buseId\s*\(/);
  assert.doesNotMatch(baseCss, /(^|\n)\s*main\s*\{/);
});

test('token usage stays consistent with design token definitions without coupling to inline styles', () => {
  const tokensCss = readFile('frontend/src/shared/styles/tokens.css');
  const baseCss = readFile('frontend/src/shared/styles/base.css');
  const declaredTokens = findTokenReferences(tokensCss);

  const componentPaths = [
    'frontend/src/shared/ui/Button.tsx',
    'frontend/src/shared/ui/Input.tsx',
    'frontend/src/shared/ui/Card.tsx',
    'frontend/src/shared/ui/Surface.tsx',
    'frontend/src/shared/ui/Table.tsx',
    'frontend/src/shared/ui/EmptyState.tsx',
    'frontend/src/shared/ui/ErrorState.tsx',
    'frontend/src/shared/ui/Spinner.tsx'
  ];

  for (const componentPath of componentPaths) {
    const source = readFile(componentPath);
    const directTokenRefs = findTokenReferences(source);
    const classNames = findClassNames(source);

    let hasTokenBackedStyles = directTokenRefs.size > 0;

    if (!hasTokenBackedStyles && classNames.size > 0) {
      for (const className of classNames) {
        const classRegex = new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?\\}`, 'm');
        const classBlock = baseCss.match(classRegex)?.[0] ?? '';
        const cssTokens = findTokenReferences(classBlock);
        if (cssTokens.size > 0) {
          hasTokenBackedStyles = true;
          for (const token of cssTokens) {
            assert.ok(declaredTokens.has(token), `${componentPath} class ${className} uses undefined token ${token}`);
          }
        }
      }
    }

    assert.ok(hasTokenBackedStyles, `${componentPath} should reference design tokens directly or via tokenized CSS classes`);

    for (const token of directTokenRefs) {
      assert.ok(declaredTokens.has(token), `${componentPath} references undefined token ${token}`);
    }
  }
});

test('card framing stays lightweight and avoids heavy shadow assumptions', () => {
  const baseCss = readFile('frontend/src/shared/styles/base.css');
  const cardBlock = findCssBlock(baseCss, '.ui-card');
  assert.ok(cardBlock, 'ui-card class exists');
  assert.doesNotMatch(cardBlock, /box-shadow|--shadow/);
});

test('theme foundation exposes the motion and dual-theme hooks the rest of the app expects', () => {
  const tokensCss = readFile('frontend/src/shared/styles/tokens.css');
  const baseCss = readFile('frontend/src/shared/styles/base.css');

  assert.match(tokensCss, /--color-bg-canvas:/);
  assert.match(tokensCss, /--color-surface-elevated:/);
  assert.match(tokensCss, /--color-text-primary:/);
  assert.match(tokensCss, /--motion-fast:/);

  const darkThemeMatch = tokensCss.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(darkThemeMatch, 'dark theme token block exists');
  const darkThemeBlock = darkThemeMatch[0];
  assert.match(darkThemeBlock, /--color-bg-canvas:/);
  assert.match(darkThemeBlock, /--color-text-primary:/);

  const focusMatch = baseCss.match(/:focus-visible\s*\{([\s\S]*?outline:[\s\S]*?)\}/);
  assert.ok(focusMatch, ':focus-visible rule exists');
  const focusBlock = focusMatch[1];
  assert.match(focusBlock, /var\(--focus-ring\)/);
  assert.match(focusBlock, /var\(--focus-offset\)/);

  assert.match(baseCss, /prefers-reduced-motion/);
  assert.match(baseCss, /\[data-theme='dark'\]/);
});
