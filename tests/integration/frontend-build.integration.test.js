const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(repoRoot, 'dist');
const frontendDistDir = path.join(distDir, 'frontend');
const manifestPath = path.join(frontendDistDir, '.vite', 'manifest.json');

const expectedPages = [
  { file: 'chat.html', identity: 'chat' },
  { file: 'admin.html', identity: 'admin' },
  { file: 'deps-monitor.html', identity: 'deps-monitor' },
  { file: 'verbose-logs.html', identity: 'verbose-logs' }
];

function runFrontendBuild() {
  return spawnSync('npm', ['run', 'build:frontend'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  });
}

function runRootBuild() {
  return spawnSync('npm', ['run', 'build'], {
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

function assertExpectedMpaOutputs(messagePrefix) {
  assert.equal(fs.existsSync(manifestPath), true, `${messagePrefix}: should emit dist/frontend/.vite/manifest.json`);

  const manifest = readManifest();

  for (const page of expectedPages) {
    const pageHtmlPath = path.join(frontendDistDir, page.file);
    assert.equal(fs.existsSync(pageHtmlPath), true, `${messagePrefix}: should emit dist/frontend/${page.file}`);

    const html = fs.readFileSync(pageHtmlPath, 'utf8');
    assert.ok(
      html.includes(`<meta name="agent-co-page" content="${page.identity}"`),
      `${messagePrefix}: ${page.file} should keep page identity marker`
    );

    const manifestEntry = manifest[page.file];
    assert.ok(manifestEntry, `${messagePrefix}: manifest should include html entry key: ${page.file}`);
    assert.equal(manifestEntry.isEntry, true, `${messagePrefix}: ${page.file} manifest entry should be isEntry`);
    assert.equal(manifestEntry.src, page.file, `${messagePrefix}: ${page.file} manifest entry src should match html file name`);
    assert.ok(
      typeof manifestEntry.file === 'string' && manifestEntry.file.startsWith('assets/'),
      `${messagePrefix}: ${page.file} manifest entry should point to bundled asset`
    );
    assert.ok(html.includes(manifestEntry.file), `${messagePrefix}: ${page.file} should reference its own manifest output asset`);
  }
}

test('build:frontend 产出真实 MPA 页面并保持 dist 安全边界', () => {
  fs.rmSync(frontendDistDir, { recursive: true, force: true });
  fs.mkdirSync(frontendDistDir, { recursive: true });

  const staleFrontendFile = path.join(frontendDistDir, 'stale.txt');
  fs.writeFileSync(staleFrontendFile, 'stale');

  const distSafetySentinel = path.join(distDir, 'frontend-build-safety-sentinel.txt');
  fs.writeFileSync(distSafetySentinel, 'do-not-delete');

  const firstBuild = runFrontendBuild();
  assert.equal(
    firstBuild.status,
    0,
    `npm run build:frontend should exit 0. stdout:\n${firstBuild.stdout || ''}\nstderr:\n${firstBuild.stderr || ''}`
  );

  assert.equal(fs.existsSync(staleFrontendFile), false, 'emptyOutDir should clear stale files inside dist/frontend');
  assert.equal(fs.readFileSync(distSafetySentinel, 'utf8'), 'do-not-delete', 'build:frontend should not delete sibling dist files outside dist/frontend');

  assertExpectedMpaOutputs('after build:frontend');
  const firstOutputFiles = listRelativeFiles(frontendDistDir);

  const rootBuild = runRootBuild();
  assert.equal(
    rootBuild.status,
    0,
    `npm run build should exit 0. stdout:\n${rootBuild.stdout || ''}\nstderr:\n${rootBuild.stderr || ''}`
  );

  assertExpectedMpaOutputs('after root build');

  const secondBuild = runFrontendBuild();
  assert.equal(
    secondBuild.status,
    0,
    `second npm run build:frontend should exit 0. stdout:\n${secondBuild.stdout || ''}\nstderr:\n${secondBuild.stderr || ''}`
  );

  const secondOutputFiles = listRelativeFiles(frontendDistDir);
  assert.deepEqual(secondOutputFiles, firstOutputFiles, 'frontend build output file set should be deterministic');

  fs.rmSync(distSafetySentinel, { force: true });
});
