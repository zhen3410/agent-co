const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const applicationDir = path.join(repoRoot, 'src', 'chat', 'application');
const chatServicePath = path.join(applicationDir, 'chat-service.ts');
const chatServiceTypesPath = path.join(applicationDir, 'chat-service-types.ts');
const chatResumeServicePath = path.join(applicationDir, 'chat-resume-service.ts');
const chatSummaryServicePath = path.join(applicationDir, 'chat-summary-service.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function collectValueExports(source) {
  const exports = new Set();

  for (const match of source.matchAll(/export (?:class|function) (\w+)/g)) {
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

test('chat-service façade 保持稳定的 value exports', () => {
  const source = read(chatServicePath);

  assert.deepEqual(
    collectValueExports(source),
    ['ChatServiceError', 'createChatService'],
    'chat-service.ts 应只暴露稳定的 chat service value exports'
  );
});

test('chat application helpers 使用语义化 AppErrorCode 而不是 statusCode 工厂契约', () => {
  const chatServiceTypesSource = read(chatServiceTypesPath);
  const chatResumeServiceSource = read(chatResumeServicePath);
  const chatSummaryServiceSource = read(chatSummaryServicePath);

  assert.match(chatServiceTypesSource, /AppErrorCode/);
  assert.doesNotMatch(chatServiceTypesSource, /ChatServiceErrorFactory = \(message: string, statusCode: number\)/);
  assert.match(chatServiceTypesSource, /interface ChatServiceErrorDescriptor \{\s*code: AppErrorCode;/s);
  assert.match(chatServiceTypesSource, /ChatServiceErrorFactory = \(message: string, error: ChatServiceErrorDescriptor\)/);
  assert.doesNotMatch(chatResumeServiceSource, /createError\(message: string, statusCode: number\)/);
  assert.doesNotMatch(chatSummaryServiceSource, /createError\(message: string, statusCode: number\)/);
  assert.doesNotMatch(chatSummaryServiceSource, /code:\s*APP_ERROR_CODES\.NOT_FOUND[\s\S]{0,80}statusCode:\s*400/);
});
