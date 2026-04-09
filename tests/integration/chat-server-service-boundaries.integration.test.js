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

function getInterfaceNode(filePath, interfaceName) {
  const sourceFile = ts.createSourceFile(filePath, read(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = null;

  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function getTypeAliasNode(filePath, aliasName) {
  const sourceFile = ts.createSourceFile(filePath, read(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = null;

  function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function hasMethodSignature(interfaceNode, methodName) {
  return interfaceNode.members.some(member => ts.isMethodSignature(member) && member.name.getText() === methodName);
}

function getMethodSignature(interfaceNode, methodName) {
  return interfaceNode.members.find(member => ts.isMethodSignature(member) && member.name.getText() === methodName) || null;
}

function getFunctionReturnedObjectLiteral(filePath, functionName) {
  const sourceFile = ts.createSourceFile(filePath, read(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fnNode = sourceFile.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName);
  if (!fnNode || !fnNode.body || fnNode.body.statements.length === 0) {
    return null;
  }

  const lastStatement = fnNode.body.statements[fnNode.body.statements.length - 1];
  if (!ts.isReturnStatement(lastStatement) || !lastStatement.expression || !ts.isObjectLiteralExpression(lastStatement.expression)) {
    return null;
  }

  return lastStatement.expression;
}

function getObjectLiteralPropertyNames(objectLiteral) {
  return objectLiteral.properties
    .map((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return property.name.getText();
      }
      if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
        return property.name.getText();
      }
      return null;
    })
    .filter(Boolean);
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

test('ChatService 暴露 stopExecution 能力', () => {
  const filePath = path.join(applicationDir, 'chat-service-types.ts');
  const chatServiceInterface = getInterfaceNode(filePath, 'ChatService');
  assert.ok(chatServiceInterface, 'chat-service-types.ts 应定义 ChatService interface');
  assert.equal(hasMethodSignature(chatServiceInterface, 'stopExecution'), true, 'ChatService 应包含 stopExecution 方法签名');
});

test('显式停止结果会携带 stopped 元数据', () => {
  const filePath = path.join(applicationDir, 'chat-service-types.ts');
  const executeAgentTurnResult = getInterfaceNode(filePath, 'ExecuteAgentTurnResult');
  assert.ok(executeAgentTurnResult, 'chat-service-types.ts 应定义 ExecuteAgentTurnResult interface');

  const stoppedMember = executeAgentTurnResult.members.find(member => ts.isPropertySignature(member) && member.name.getText() === 'stopped');
  assert.ok(stoppedMember, 'ExecuteAgentTurnResult 应暴露 stopped 元数据字段');
  assert.equal(stoppedMember.questionToken !== undefined, true, 'stopped 字段应为可选');
  assert.equal(stoppedMember.type.getText(), 'StoppedExecutionMetadata', 'stopped 字段应使用 StoppedExecutionMetadata');

  const stoppedTypeAlias = getTypeAliasNode(filePath, 'StoppedExecutionMetadata');
  assert.ok(stoppedTypeAlias, 'chat-service-types.ts 应通过别名暴露 StoppedExecutionMetadata');
  assert.equal(stoppedTypeAlias.type.getText(), 'ChatExecutionStoppedMetadata', 'StoppedExecutionMetadata 应复用共享 ChatExecutionStoppedMetadata');
});

test('stream/SSE 返回契约暴露 stopped 元数据', () => {
  const filePath = path.join(applicationDir, 'chat-service-types.ts');
  const chatServiceInterface = getInterfaceNode(filePath, 'ChatService');
  assert.ok(chatServiceInterface, 'chat-service-types.ts 应定义 ChatService interface');

  const streamMethod = getMethodSignature(chatServiceInterface, 'streamMessage');
  assert.ok(streamMethod, 'ChatService 应定义 streamMessage');
  assert.ok(streamMethod.type && ts.isTypeReferenceNode(streamMethod.type), 'streamMessage 应返回 Promise 类型');
  assert.equal(streamMethod.type.typeName.getText(), 'Promise', 'streamMessage 返回值应为 Promise');
  assert.ok(streamMethod.type.typeArguments?.[0] && ts.isTypeLiteralNode(streamMethod.type.typeArguments[0]), 'streamMessage Promise 泛型参数应为对象类型');

  const streamReturnShape = streamMethod.type.typeArguments[0];
  const stoppedMember = streamReturnShape.members.find(member => ts.isPropertySignature(member) && member.name.getText() === 'stopped');
  assert.ok(stoppedMember, 'streamMessage 返回类型应包含 stopped 字段');
  assert.equal(stoppedMember.questionToken !== undefined, true, 'streamMessage.stopped 应为可选');
  assert.equal(stoppedMember.type.getText(), 'StoppedExecutionMetadata', 'streamMessage.stopped 应使用 StoppedExecutionMetadata');
});

test('stopExecution 请求契约禁止 none（运行时校验在后续任务实现）', () => {
  const filePath = path.join(applicationDir, 'chat-service-types.ts');
  const chatServiceInterface = getInterfaceNode(filePath, 'ChatService');
  assert.ok(chatServiceInterface, 'chat-service-types.ts 应定义 ChatService interface');

  const stopExecutionMethod = getMethodSignature(chatServiceInterface, 'stopExecution');
  assert.ok(stopExecutionMethod, 'ChatService 应定义 stopExecution');
  assert.equal(stopExecutionMethod.parameters[1].type.getText(), 'StopExecutionRequest', 'stopExecution 第二参数应使用 StopExecutionRequest 契约');

  const requestInterface = getInterfaceNode(filePath, 'StopExecutionRequest');
  assert.ok(requestInterface, 'chat-service-types.ts 应定义 StopExecutionRequest interface');

  const scopeMember = requestInterface.members.find(member => ts.isPropertySignature(member) && member.name.getText() === 'scope');
  assert.ok(scopeMember, 'StopExecutionRequest 应定义 scope');
  assert.equal(scopeMember.type.getText(), "Exclude<ChatExecutionStopMode, 'none'>", 'scope 应禁止 none');
});

test('ChatRuntime 停止执行 API 为必填契约', () => {
  const filePath = path.join(repoRoot, 'src', 'chat', 'runtime', 'chat-runtime-types.ts');
  const chatRuntimeInterface = getInterfaceNode(filePath, 'ChatRuntime');
  assert.ok(chatRuntimeInterface, 'chat-runtime-types.ts 应定义 ChatRuntime interface');

  const expectedMethods = [
    'registerActiveExecution',
    'getActiveExecution',
    'updateActiveExecutionAgent',
    'requestExecutionStop',
    'consumeExecutionStopMode',
    'consumeExecutionStopResult',
    'clearActiveExecution'
  ];

  for (const methodName of expectedMethods) {
    const method = getMethodSignature(chatRuntimeInterface, methodName);
    assert.ok(method, `ChatRuntime 应定义 ${methodName} 方法`);
    assert.equal(method.questionToken === undefined, true, `${methodName} 不应为可选方法`);
  }

  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'registerActiveExecution').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'execution'],
    'registerActiveExecution 应按 user+session 维度注册'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'getActiveExecution').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId'],
    'getActiveExecution 应按 user+session 查询'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'updateActiveExecutionAgent').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'executionId', 'agentName'],
    'updateActiveExecutionAgent 应显式声明 user/session/execution 保护参数'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'requestExecutionStop').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'stopMode'],
    'requestExecutionStop 应按 user+session 请求停止'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'consumeExecutionStopMode').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'executionId'],
    'consumeExecutionStopMode 应使用 user + session + execution 守卫'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'consumeExecutionStopResult').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'executionId'],
    'consumeExecutionStopResult 应使用 user + session + execution 守卫'
  );
  assert.deepEqual(
    getMethodSignature(chatRuntimeInterface, 'clearActiveExecution').parameters.map(parameter => parameter.name.getText()),
    ['userKey', 'sessionId', 'executionId'],
    'clearActiveExecution 应使用 user + session + execution 守卫'
  );

  const stopResultAlias = getTypeAliasNode(filePath, 'ActiveChatExecutionStopResult');
  assert.ok(stopResultAlias, 'chat-runtime-types.ts 应定义 ActiveChatExecutionStopResult');
  assert.equal(stopResultAlias.type.getText(), 'ChatExecutionStoppedMetadata', 'ActiveChatExecutionStopResult 应复用共享 ChatExecutionStoppedMetadata');
});

test('chat-service 实现层返回 stopExecution façade 方法', () => {
  const filePath = path.join(applicationDir, 'chat-service.ts');
  const returnedObject = getFunctionReturnedObjectLiteral(filePath, 'createChatService');
  assert.ok(returnedObject, 'createChatService 应返回对象字面量 façade');

  const propertyNames = getObjectLiteralPropertyNames(returnedObject);
  assert.ok(propertyNames.includes('stopExecution'), 'createChatService 返回对象应挂载 stopExecution');
});

test('chat-runtime 实现层返回 stop contract 方法集合', () => {
  const filePath = path.join(repoRoot, 'src', 'chat', 'runtime', 'chat-runtime.ts');
  const returnedObject = getFunctionReturnedObjectLiteral(filePath, 'createChatRuntime');
  assert.ok(returnedObject, 'createChatRuntime 应返回对象字面量 runtime');

  const propertyNames = getObjectLiteralPropertyNames(returnedObject);
  const expectedMethods = [
    'registerActiveExecution',
    'getActiveExecution',
    'updateActiveExecutionAgent',
    'requestExecutionStop',
    'consumeExecutionStopMode',
    'consumeExecutionStopResult',
    'clearActiveExecution'
  ];

  for (const methodName of expectedMethods) {
    assert.ok(propertyNames.includes(methodName), `createChatRuntime 返回对象应挂载 ${methodName}`);
  }
});

test('共享停止模式 union 保持窄类型', () => {
  const filePath = path.join(repoRoot, 'src', 'types.ts');
  const stopModeAlias = getTypeAliasNode(filePath, 'ChatExecutionStopMode');
  assert.ok(stopModeAlias, 'types.ts 应定义 ChatExecutionStopMode');
  assert.equal(stopModeAlias.type.getText(), "'none' | 'current_agent' | 'session'");

  const stoppedMetadata = getInterfaceNode(filePath, 'ChatExecutionStoppedMetadata');
  assert.ok(stoppedMetadata, 'types.ts 应定义共享 ChatExecutionStoppedMetadata');
  const fields = stoppedMetadata.members.filter(member => ts.isPropertySignature(member)).map(member => member.name.getText()).sort();
  assert.deepEqual(fields, ['currentAgent', 'resumeAvailable', 'scope']);
});
