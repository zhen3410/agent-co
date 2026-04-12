const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendDistDir = path.join(repoRoot, 'dist', 'frontend');
const manifestPath = path.join(frontendDistDir, '.vite', 'manifest.json');
const protectedBackendFile = path.join(repoRoot, 'src', 'server.ts');

const expectedPages = ['chat', 'admin', 'deps-monitor', 'verbose-logs'];

function runFrontendBuild() {
  return spawnSync('npm', ['run', 'build:frontend'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  });
}

function listRelativeFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      files.push(path.relative(dirPath, absolute).split(path.sep).join('/'));
    }
  }

  return files.sort();
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

test('build:frontend 输出命名 MPA 页面并保持产物路径稳定且不覆盖后端源码', () => {
  fs.rmSync(frontendDistDir, { recursive: true, force: true });
  const backendBefore = fs.readFileSync(protectedBackendFile, 'utf8');

  const firstBuild = runFrontendBuild();
  assert.equal(
    firstBuild.status,
    0,
    `npm run build:frontend should exit 0. stdout:\n${firstBuild.stdout || ''}\nstderr:\n${firstBuild.stderr || ''}`
  );

  assert.equal(fs.existsSync(manifestPath), true, 'should emit dist/frontend/.vite/manifest.json');

  for (const page of expectedPages) {
    const pageHtmlPath = path.join(frontendDistDir, `${page}.html`);
    assert.equal(fs.existsSync(pageHtmlPath), true, `should emit dist/frontend/${page}.html`);

    const html = fs.readFileSync(pageHtmlPath, 'utf8');
    assert.ok(html.includes('<div id="app"></div>'), `${page}.html should contain #app mount point`);
    assert.ok(html.includes('type="module"'), `${page}.html should load page entry module`);
  }

  const manifest = readManifest();
  for (const page of expectedPages) {
    const entry = Object.values(manifest).find(item => item && item.isEntry && item.name === page);
    assert.ok(entry, `manifest should contain named entry for page: ${page}`);
    assert.ok(typeof entry.file === 'string' && entry.file.startsWith('assets/'), `${page} manifest entry should point to bundled asset`);
  }

  const firstOutputFiles = listRelativeFiles(frontendDistDir);

  const secondBuild = runFrontendBuild();
  assert.equal(
    secondBuild.status,
    0,
    `second npm run build:frontend should exit 0. stdout:\n${secondBuild.stdout || ''}\nstderr:\n${secondBuild.stderr || ''}`
  );

  const secondOutputFiles = listRelativeFiles(frontendDistDir);
  assert.deepEqual(secondOutputFiles, firstOutputFiles, 'frontend build output file set should be deterministic');

  const backendAfter = fs.readFileSync(protectedBackendFile, 'utf8');
  assert.equal(backendAfter, backendBefore, 'frontend build must not overwrite src/server.ts');
});
