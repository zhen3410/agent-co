const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '../..');
const moduleCache = new Map();

function resolveExistingFile(basePath) {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, path.join(basePath, 'index.ts'), path.join(basePath, 'index.tsx')];
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
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: resolvedPath
  });
  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);
  const localRequire = (specifier) => specifier.startsWith('.') ? loadTsModule(path.relative(rootDir, path.resolve(path.dirname(resolvedPath), specifier))) : require(specifier);
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}

test('agent form trims string fields and removes API-only fields in CLI mode', () => {
  const { normalizeAgentDraft } = loadTsModule('frontend/src/admin/features/agents/agent-form.ts');
  const result = normalizeAgentDraft({
    name: ' Alice ', avatar: ' 🤖 ', personality: ' helper ', color: ' #fff ', systemPrompt: ' hi ', workdir: ' /workspace/demo ', executionMode: 'cli', cliName: 'codex', apiConnectionId: 'primary', apiModel: 'gpt'
  });
  assert.equal(result.name, 'Alice');
  assert.equal(result.workdir, '/workspace/demo');
  assert.equal(result.apiConnectionId, undefined);
});

test('group form rejects duplicate or unknown agent members', () => {
  const { normalizeGroupDraft } = loadTsModule('frontend/src/admin/features/groups/group-form.ts');
  assert.throws(() => normalizeGroupDraft({ id: 'core', name: 'Core', icon: '🧩', agentNames: 'Alice, Alice, Ghost' }, ['Alice']), /重复智能体|未知智能体/);
});

test('user form trims username and only sends password when provided', () => {
  const { normalizeUserDraft } = loadTsModule('frontend/src/admin/features/users/user-form.ts');
  const result = normalizeUserDraft({ username: ' demo ', password: 'secret' });
  assert.equal(result.username, 'demo');
  assert.equal(result.password, 'secret');
});

test('model connection form trims baseURL and preserves enabled state', () => {
  const { normalizeModelConnectionDraft } = loadTsModule('frontend/src/admin/features/model-connections/model-connection-form.ts');
  const result = normalizeModelConnectionDraft({ name: 'Primary', baseURL: ' https://api.example.test/ ', enabled: true, apiKey: ' sk-1 ' }, true);
  assert.equal(result.baseURL, 'https://api.example.test/');
  assert.equal(result.enabled, true);
  assert.equal(result.apiKey, 'sk-1');
});
