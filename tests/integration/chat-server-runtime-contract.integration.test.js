const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimeFacadePath = path.join(repoRoot, 'src', 'chat', 'runtime', 'chat-runtime.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function collectValueExports(source) {
  const exports = new Set();

  for (const match of source.matchAll(/export function (\w+)\s*\(/g)) {
    exports.add(match[1]);
  }

  for (const match of source.matchAll(/export \{([^}]+)\} from /g)) {
    const names = match[1].split(',').map(part => part.trim()).filter(Boolean);
    for (const name of names) {
      if (!name.startsWith('type ')) {
        exports.add(name.split(/\s+as\s+/)[0].trim());
      }
    }
  }

  return [...exports].sort();
}

test('chat-runtime 模块保持稳定且克制的 value export surface', () => {
  const runtimeFacadeSource = read(runtimeFacadePath);

  assert.deepEqual(
    collectValueExports(runtimeFacadeSource),
    ['createChatRuntime', 'normalizePositiveSessionSetting'],
    'chat-runtime.ts 应只暴露稳定的 runtime value exports'
  );
});
