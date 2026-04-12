const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

function readFile(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
}

test('shared UI components use semantic markup', () => {
  const button = readFile('frontend/src/shared/ui/Button.tsx');
  const input = readFile('frontend/src/shared/ui/Input.tsx');
  const card = readFile('frontend/src/shared/ui/Card.tsx');
  const table = readFile('frontend/src/shared/ui/Table.tsx');

  assert.match(button, /<button\b/);
  assert.match(input, /<input\b/);
  assert.match(input, /<label\b/);
  assert.match(card, /<article\b|<section\b/);
  assert.match(table, /<table\b/);
  assert.match(table, /<thead\b/);
  assert.match(table, /<tbody\b/);
});

test('design token files define required categories and base references', () => {
  const tokens = readFile('frontend/src/shared/styles/tokens.css');
  const base = readFile('frontend/src/shared/styles/base.css');

  assert.match(tokens, /--color-/);
  assert.match(tokens, /--space-/);
  assert.match(tokens, /--radius-/);
  assert.match(tokens, /--shadow-/);
  assert.match(tokens, /--font-/);
  assert.match(tokens, /--status-(?:success|error|warning|info)/);

  assert.match(base, /var\(--color-/);
  assert.match(base, /var\(--font-/);
  assert.match(base, /var\(--space-/);
});

test('loading/error/empty primitives are composable and exported', () => {
  const emptyState = readFile('frontend/src/shared/ui/EmptyState.tsx');
  const errorState = readFile('frontend/src/shared/ui/ErrorState.tsx');
  const spinner = readFile('frontend/src/shared/ui/Spinner.tsx');
  const barrel = readFile('frontend/src/shared/ui/index.ts');

  assert.match(emptyState, /action\?:\s*ReactNode/);
  assert.match(emptyState, /\{action\}/);
  assert.match(errorState, /action\?:\s*ReactNode/);
  assert.match(errorState, /\{action\}/);
  assert.match(spinner, /role="status"/);

  assert.match(barrel, /export \* from '\.\/EmptyState';/);
  assert.match(barrel, /export \* from '\.\/ErrorState';/);
  assert.match(barrel, /export \* from '\.\/Spinner';/);
});
