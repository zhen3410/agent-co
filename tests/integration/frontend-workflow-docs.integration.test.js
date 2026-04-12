const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludesAll(content, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(content.includes(snippet), `${label} should mention: ${snippet}`);
  }
}

test('scripts/init-dev.sh 明确提示本地前端开发循环与静态产物位置', () => {
  const script = readRepoFile('scripts/init-dev.sh');

  assertIncludesAll(script, [
    'npm install',
    'npm run build',
    'npm run dev:frontend',
    'dist/frontend'
  ], 'scripts/init-dev.sh');
});

test('README.md 记录前端本地开发、生产构建顺序与缺失构建时的回滚影响', () => {
  const readme = readRepoFile('README.md');

  assertIncludesAll(readme, [
    'npm run dev:frontend',
    'dist/frontend',
    '前端构建产物缺失',
    '回滚'
  ], 'README.md');
});

test('README_EN.md records frontend local dev, production build order, and rollback implications', () => {
  const readme = readRepoFile('README_EN.md');

  assertIncludesAll(readme, [
    'npm run dev:frontend',
    'dist/frontend',
    'frontend build artifacts are missing',
    'rollback'
  ], 'README_EN.md');
});

test('DEPLOYMENT.md 与 systemd 安装脚本要求先生成前端构建产物', () => {
  const deploymentDoc = readRepoFile('DEPLOYMENT.md');
  const installScript = readRepoFile('scripts/install-systemd.sh');

  assertIncludesAll(deploymentDoc, [
    'npm run build',
    'dist/frontend',
    '回滚'
  ], 'DEPLOYMENT.md');

  assertIncludesAll(installScript, [
    'npm run build',
    'dist/frontend/chat.html',
    'dist/frontend/admin.html'
  ], 'scripts/install-systemd.sh');
});
