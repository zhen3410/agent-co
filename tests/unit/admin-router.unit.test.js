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

test('admin routes cover dashboard, list, create, and edit pages', () => {
  const { matchAdminRoute, buildAdminPath } = loadTsModule('frontend/src/admin/app/admin-routes.ts');

  assert.deepEqual(matchAdminRoute('/admin/agents'), { section: 'agents', view: 'list' });
  assert.deepEqual(matchAdminRoute('/admin/agents/new'), { section: 'agents', view: 'create' });
  assert.deepEqual(matchAdminRoute('/admin/agents/Alice/edit'), { section: 'agents', view: 'edit', params: { name: 'Alice' } });
  assert.deepEqual(matchAdminRoute('/admin/groups/core/edit'), { section: 'groups', view: 'edit', params: { id: 'core' } });
  assert.equal(buildAdminPath({ section: 'groups', view: 'create' }), '/admin/groups/new');
  assert.equal(buildAdminPath({ section: 'users', view: 'edit', params: { name: 'alice' } }), '/admin/users/alice/edit');
});
