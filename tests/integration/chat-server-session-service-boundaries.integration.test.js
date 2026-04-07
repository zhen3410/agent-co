const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const applicationDir = path.join(repoRoot, 'src', 'chat', 'application');
const sessionServicePath = path.join(applicationDir, 'session-service.ts');
const sessionServiceTypesPath = path.join(applicationDir, 'session-service-types.ts');
const sessionAgentServicePath = path.join(applicationDir, 'session-agent-service.ts');
const sessionCommandServicePath = path.join(applicationDir, 'session-command-service.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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

test('session-service façade 不再直接内联低层 session 状态改写', () => {
  const source = read(sessionServicePath);
  const sourceFile = ts.createSourceFile(sessionServicePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const directMutationNodes = [];

  function isSessionPropertyAccess(node, propertyName) {
    return ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'session'
      && node.name.text === propertyName;
  }

  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (
        isSessionPropertyAccess(node.left, 'pendingAgentTasks')
        || isSessionPropertyAccess(node.left, 'pendingVisibleMessages')
        || isSessionPropertyAccess(node.left, 'discussionState')
      ) {
        directMutationNodes.push(node.getText(sourceFile));
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      if (
        callee.name.text === 'push'
        && ts.isPropertyAccessExpression(callee.expression)
        && isSessionPropertyAccess(callee.expression, 'history')
      ) {
        directMutationNodes.push(node.getText(sourceFile));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  assert.deepEqual(directMutationNodes, []);
});

test('session application helpers 使用语义化 AppErrorCode 而不是 statusCode 工厂契约', () => {
  const sessionServiceTypesSource = read(sessionServiceTypesPath);
  const sessionAgentServiceSource = read(sessionAgentServicePath);
  const sessionCommandServiceSource = read(sessionCommandServicePath);

  assert.match(sessionServiceTypesSource, /AppErrorCode/);
  assert.doesNotMatch(sessionServiceTypesSource, /SessionServiceErrorFactory = \(message: string, statusCode: number\)/);
  assert.match(sessionServiceTypesSource, /interface SessionServiceErrorDescriptor \{\s*code: AppErrorCode;/s);
  assert.match(sessionServiceTypesSource, /SessionServiceErrorFactory = \(message: string, error: SessionServiceErrorDescriptor\)/);
  assert.doesNotMatch(sessionAgentServiceSource, /createError\([^)]*statusCode: number/);
  assert.doesNotMatch(sessionCommandServiceSource, /createError\([^)]*statusCode: number/);
  assert.doesNotMatch(sessionAgentServiceSource, /code:\s*APP_ERROR_CODES\.NOT_FOUND[\s\S]{0,80}statusCode:\s*400/);
  assert.doesNotMatch(sessionCommandServiceSource, /code:\s*APP_ERROR_CODES\.NOT_FOUND[\s\S]{0,80}statusCode:\s*400/);
});
