const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const rootDir = process.cwd();
const moduleCache = new Map();
function resolveExistingFile(basePath) {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, path.join(basePath, 'index.ts'), path.join(basePath, 'index.tsx')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve module path: ${basePath}`);
}
function loadTsModule(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const resolvedPath = resolveExistingFile(absolutePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: resolvedPath });
  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod.exports);
  const localRequire = (specifier) => {
    if (specifier.endsWith('.css')) return {};
    if (specifier.startsWith('.')) {
      const childBasePath = path.resolve(path.dirname(resolvedPath), specifier);
      const childRelativePath = path.relative(rootDir, childBasePath);
      return loadTsModule(childRelativePath);
    }
    return require(specifier);
  };
  const fn = new Function('require','module','exports','__filename','__dirname', transpiled.outputText);
  fn(localRequire, mod, mod.exports, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, mod.exports);
  return mod.exports;
}
const { ChatMessageList } = loadTsModule('frontend/src/chat/features/message-list/ChatMessageList.tsx');
const sample = [
  { id:'1', role:'assistant', sender:'Alice', text:'辛苦\n\n回家多喝热水多吃饭补补身体', timestamp:1 },
  { id:'2', role:'user', sender:'我', text:'我刚下班。早点回家休息', timestamp:2 },
  { id:'3', role:'assistant', sender:'Alice', text:'目前最近的工作就是上周五上午上传了项目 5 个工程问题，我连现场都没去，同事帮拍的。', timestamp:3 },
  { id:'4', role:'user', sender:'我', text:'你这工作太不饱和了', timestamp:4 },
  { id:'5', role:'assistant', sender:'Reviewer', text:'accept: 已确认普通消息应更接近 IM 气泡样式。', reviewDisplayText:'已确认普通消息应更接近 IM 气泡样式。', messageSubtype:'invocation_review', reviewAction:'accept', timestamp:5 }
];
const html = renderToStaticMarkup(React.createElement(ChatMessageList, { messages: sample }));
const doc = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px} *{box-sizing:border-box} .chat-host{max-width:393px;margin:0 auto;} :root{--space-1:.25rem;--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--radius-md:.75rem;--color-text:#111827;--color-text-muted:#6b7280;--color-text-tertiary:#94a3b8;--font-size-sm:13px;--font-weight-semibold:600;}</style></head><body><div class="chat-host">${html}</div></body></html>`;
fs.writeFileSync('.tmp/message-sample.html', doc);
console.log('.tmp/message-sample.html');
