const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const applicationDir = path.join(repoRoot, 'src', 'chat', 'application');
const distDir = path.join(repoRoot, 'dist');
const sessionServicePath = path.join(applicationDir, 'session-service.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function requireBuiltModule(...segments) {
  const modulePath = path.join(distDir, ...segments);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function collectValueExports(source) {
  const sourceFile = ts.createSourceFile(sessionServicePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && node.name
      && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) {
        exports.add(node.name.text);
      }
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

test('session-service façade 保持稳定的 value exports', () => {
  const source = read(sessionServicePath);

  assert.deepEqual(
    collectValueExports(source),
    ['SessionServiceError', 'createSessionService'],
    'session-service.ts 应只暴露稳定的 session service value exports'
  );
});

test('session discussion helper owns summary continuation mutations behind the façade', () => {
  const { createSessionDiscussionService } = requireBuiltModule('chat', 'application', 'session-discussion-service.js');
  const touchCalls = [];
  const service = createSessionDiscussionService({
    runtime: {
      touchSession(session) {
        touchCalls.push(session.id);
      },
      normalizeDiscussionMode(value) {
        return value === 'peer' ? 'peer' : 'classic';
      },
      normalizeDiscussionState(value) {
        return value === 'summarizing' ? 'summarizing' : 'active';
      },
      hasSummaryRequest() {
        return false;
      },
      getSessionEnabledAgents() {
        return ['Alice'];
      }
    }
  });
  const session = {
    id: 'session-1',
    discussionMode: 'peer',
    discussionState: 'active',
    pendingAgentTasks: [{ agentName: 'Alice', prompt: '继续', includeHistory: true }],
    pendingVisibleMessages: [{ id: 'm1', role: 'assistant', sender: 'Alice', text: '继续', timestamp: 1 }],
    history: [],
    currentAgent: 'Alice'
  };
  const snapshot = service.snapshotSummaryContinuationState(session);

  service.markSummaryInProgress(session);
  service.restoreSummaryContinuationState(session, snapshot);

  assert.equal(session.discussionState, 'active');
  assert.deepEqual(session.pendingAgentTasks, snapshot.pendingAgentTasks);
  assert.deepEqual(session.pendingVisibleMessages, snapshot.pendingVisibleMessages);
  assert.deepEqual(touchCalls, ['session-1', 'session-1']);
});

test('session command helper uses semantic validation descriptors for invalid session mutations', () => {
  const { APP_ERROR_CODES } = requireBuiltModule('shared', 'errors', 'app-error-codes.js');
  const { createSessionCommandService } = requireBuiltModule('chat', 'application', 'session-command-service.js');
  const service = createSessionCommandService({
    runtime: {},
    queryService: {},
    createError(message, error) {
      const failure = new Error(message);
      failure.descriptor = error;
      return failure;
    }
  });

  assert.throws(
    () => service.updateChatSession({ userKey: 'user-1' }, '', {}),
    (error) => {
      assert.equal(error.message, 'sessionId 不能为空');
      assert.deepEqual(error.descriptor, {
        code: APP_ERROR_CODES.VALIDATION_FAILED
      });
      return true;
    }
  );
});

test('session command helper normalizes patched session settings before returning the response contract', () => {
  const { createSessionCommandService } = requireBuiltModule('chat', 'application', 'session-command-service.js');
  const session = {
    id: 'session-1',
    discussionMode: 'classic',
    discussionState: 'paused',
    history: []
  };
  const calls = [];
  const service = createSessionCommandService({
    runtime: {
      ensureUserSessions() {
        return new Map([[session.id, session]]);
      },
      parseSessionChainPatch(patch) {
        calls.push(['parse', patch]);
        return { agentChainMaxHops: 3, discussionMode: 'peer' };
      },
      applyNormalizedSessionChainSettings(currentSession) {
        currentSession.agentChainMaxHops = 3;
        calls.push(['chain', currentSession.id]);
        return currentSession;
      },
      applyNormalizedSessionDiscussionSettings(currentSession) {
        currentSession.discussionMode = 'peer';
        currentSession.discussionState = 'active';
        calls.push(['discussion', currentSession.id]);
        return currentSession;
      },
      touchSession(currentSession) {
        calls.push(['touch', currentSession.id]);
      }
    },
    queryService: {
      buildMutationResponse(userKey, currentSession) {
        return {
          success: true,
          session: currentSession,
          enabledAgents: [],
          chatSessions: [],
          activeSessionId: currentSession.id,
          userKey
        };
      }
    },
    createError(message) {
      return new Error(message);
    }
  });

  const result = service.updateChatSession({ userKey: 'user-1' }, session.id, { discussionMode: 'peer' });

  assert.equal(result.success, true);
  assert.equal(result.session.discussionMode, 'peer');
  assert.equal(result.session.discussionState, 'active');
  assert.deepEqual(calls.map(([step]) => step), ['parse', 'chain', 'discussion', 'touch']);
});
