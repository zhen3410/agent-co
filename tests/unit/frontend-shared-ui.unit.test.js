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

test('shared primitives render semantic HTML elements', () => {
  const { Button } = loadTsModule('frontend/src/shared/ui/Button.tsx');
  const { Input } = loadTsModule('frontend/src/shared/ui/Input.tsx');
  const { Card } = loadTsModule('frontend/src/shared/ui/Card.tsx');
  const { Table } = loadTsModule('frontend/src/shared/ui/Table.tsx');

  const buttonHtml = render(Button, { children: 'Save' });
  assert.match(buttonHtml, /^<button[^>]*>Save<\/button>$/);

  const inputHtml = render(Input, { id: 'name', label: 'Name', hint: 'Required' });
  assert.match(inputHtml, /<label[^>]*for="name"/);
  assert.match(inputHtml, /<input[^>]*id="name"/);

  const cardHtml = render(Card, { title: 'Title', children: React.createElement('p', null, 'Body') });
  assert.match(cardHtml, /^<article\b/);
  assert.match(cardHtml, /<header\b/);

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

test('loading/error/empty primitives compose with shared actions', () => {
  const { Button } = loadTsModule('frontend/src/shared/ui/Button.tsx');
  const { EmptyState } = loadTsModule('frontend/src/shared/ui/EmptyState.tsx');
  const { ErrorState } = loadTsModule('frontend/src/shared/ui/ErrorState.tsx');
  const { Spinner } = loadTsModule('frontend/src/shared/ui/Spinner.tsx');
  const ui = loadTsModule('frontend/src/shared/ui/index.ts');

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

  assert.equal(typeof ui.Button, 'function');
  assert.equal(typeof ui.EmptyState, 'function');
  assert.equal(typeof ui.ErrorState, 'function');
  assert.equal(typeof ui.Spinner, 'function');
});

test('each shared primitive references declared design tokens consistently', () => {
  const tokensCss = readFile('frontend/src/shared/styles/tokens.css');
  const declaredTokens = new Set(Array.from(tokensCss.matchAll(/--[a-z0-9-]+/g), (match) => match[0]));

  const { Button } = loadTsModule('frontend/src/shared/ui/Button.tsx');
  const { Input } = loadTsModule('frontend/src/shared/ui/Input.tsx');
  const { Card } = loadTsModule('frontend/src/shared/ui/Card.tsx');
  const { Table } = loadTsModule('frontend/src/shared/ui/Table.tsx');
  const { EmptyState } = loadTsModule('frontend/src/shared/ui/EmptyState.tsx');
  const { ErrorState } = loadTsModule('frontend/src/shared/ui/ErrorState.tsx');
  const { Spinner } = loadTsModule('frontend/src/shared/ui/Spinner.tsx');

  const renderings = [
    ['Button', render(Button, { children: 'Apply' })],
    ['Input', render(Input, { id: 'email', label: 'Email' })],
    ['Card', render(Card, { title: 'Card', children: 'Content' })],
    [
      'Table',
      render(Table, {
        columns: [{ key: 'value', header: 'Value', render: (row) => row.value }],
        rows: [{ value: 'A' }],
        getRowKey: (row) => row.value
      })
    ],
    ['EmptyState', render(EmptyState, { title: 'Empty' })],
    ['ErrorState', render(ErrorState, { message: 'Error' })],
    ['Spinner', render(Spinner, {})]
  ];

  for (const [name, html] of renderings) {
    const usedTokens = Array.from(html.matchAll(/var\((--[a-z0-9-]+)\)/g), (match) => match[1]);
    assert.ok(usedTokens.length > 0, `${name} should use design tokens in rendered styles`);

    for (const token of usedTokens) {
      assert.ok(declaredTokens.has(token), `${name} references undefined token ${token}`);
    }
  }
});
