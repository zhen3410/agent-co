const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const applicationDir = path.join(repoRoot, 'src', 'chat', 'application');
const distDir = path.join(repoRoot, 'dist');
const chatServicePath = path.join(applicationDir, 'chat-service.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function collectValueExports(filePath) {
  const sourceFile = ts.createSourceFile(filePath, read(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exports = new Set();

  function addBindingName(nameNode) {
    if (ts.isIdentifier(nameNode)) {
      exports.add(nameNode.text);
      return;
    }

    if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
      for (const element of nameNode.elements) {
        if (ts.isBindingElement(element)) {
          addBindingName(element.name);
        }
      }
    }
  }

  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name
      && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      exports.add(node.name.text);
    }

    if (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        addBindingName(declaration.name);
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const isTypeOnly = Boolean(element.isTypeOnly) || Boolean(node.isTypeOnly);
        if (!isTypeOnly) {
          exports.add(element.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...exports].sort();
}

test('chat-service façade 保持稳定的 value exports', () => {
  assert.deepEqual(
    collectValueExports(chatServicePath),
    ['ChatServiceError', 'createChatService'],
    'chat-service.ts 应只暴露稳定的 chat service value exports'
  );
});

test('chat resume helper reports summary conflicts through semantic error descriptors', async () => {
  const { APP_ERROR_CODES } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');
  const { createChatResumeService } = requireBuiltModule('chat', 'application', 'chat-resume-service.js');
  const session = { id: 'session-1' };
  const service = createChatResumeService({
    syncAgentsFromStore() {},
    sessionService: {
      resolveChatSession() {
        return { userKey: 'user-1', session };
      },
      isSessionSummaryInProgress() {
        return true;
      }
    },
    async executeAgentTurn() {
      throw new Error('should not execute');
    },
    createError(message, error) {
      const failure = new Error(message);
      failure.descriptor = error;
      return failure;
    }
  });

  await assert.rejects(
    () => service.resumePendingChat({ userKey: 'user-1' }),
    (error) => {
      assert.equal(error.message, '当前会话正在生成总结，暂时不能继续执行剩余链路，请稍后再试。');
      assert.deepEqual(error.descriptor, {
        code: APP_ERROR_CODES.CONFLICT
      });
      return true;
    }
  );
});

test('chat summary helper keeps manual-summary dispatch behavior stable', async () => {
  const { createChatSummaryService } = requireBuiltModule('chat', 'application', 'chat-summary-service.js');
  const session = {
    id: 'session-1',
    discussionMode: 'peer',
    discussionState: 'active'
  };
  const events = [];
  const service = createChatSummaryService({
    syncAgentsFromStore() {
      events.push('sync');
    },
    runtime: {
      ensureUserSessions() {
        return new Map([[session.id, session]]);
      },
      resolveActiveSession() {
        return session;
      },
      normalizeDiscussionMode(value) {
        return value === 'peer' ? 'peer' : 'classic';
      },
      beginSummaryRequest(key) {
        events.push(['begin', key]);
        return true;
      },
      appendOperationalLog(level, dependency, message) {
        events.push(['log', level, dependency, message]);
      },
      endSummaryRequest(key) {
        events.push(['end', key]);
      }
    },
    sessionService: {
      resolveManualSummaryAgent() {
        return 'Alice';
      },
      snapshotSummaryContinuationState() {
        return { discussionState: 'active' };
      },
      markSummaryInProgress(currentSession) {
        currentSession.discussionState = 'summarizing';
        events.push('mark');
      },
      buildManualSummaryPrompt() {
        return 'PROMPT';
      },
      restoreSummaryContinuationState(currentSession, snapshot) {
        currentSession.discussionState = snapshot.discussionState;
        events.push(['restore', snapshot.discussionState]);
      },
      getCurrentAgent() {
        return 'Alice';
      }
    },
    async executeAgentTurn(params) {
      events.push(['execute', params.initialTasks[0]]);
      return {
        aiMessages: [{ id: 'm1', role: 'assistant', sender: 'Alice', text: '总结', timestamp: 1 }],
        pendingTasks: []
      };
    },
    createError(message) {
      return new Error(message);
    }
  });

  const result = await service.summarizeChat({ userKey: 'user-1' });

  assert.equal(result.success, true);
  assert.equal(result.currentAgent, 'Alice');
  assert.deepEqual(events[0], 'sync');
  assert.deepEqual(events.find(event => Array.isArray(event) && event[0] === 'begin'), ['begin', 'user-1::session-1']);
  assert.deepEqual(events.find(event => Array.isArray(event) && event[0] === 'execute')[1], {
    agentName: 'Alice',
    prompt: 'PROMPT',
    includeHistory: true,
    dispatchKind: 'summary'
  });
  assert.deepEqual(events.at(-1), ['end', 'user-1::session-1']);
});
