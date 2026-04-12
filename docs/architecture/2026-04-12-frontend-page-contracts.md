# Frontend 页面契约冻结（2026-04-12）

> 目的：在 React + Vite + TS MPA 迁移前，冻结当前页面行为契约，避免回归。

## 1. `public/index.html`（聊天主页面）

### 页面职责
- 提供聊天主界面：消息流、会话切换、智能体开关、工作目录选择、会话链路设置、移动端抽屉/控制中心。
- 负责登录态处理（覆盖层登录）、消息发送、会话时间线同步、停止/恢复执行、讨论摘要。
- 通过 `chat-markdown.js`/`chat-composer.js` 提供 Markdown 渲染、编辑器预览与移动端输入抽屉能力。

### 启动顺序（Boot Sequence）
1. HTML 先挂载 `#app`，通过内联 Babel JSX 渲染 React UMD 结构（仅视图壳）。
2. 先加载 `/chat-markdown.js`、`/chat-composer.js`，向 `window` 暴露 `ChatMarkdown`/`ChatComposer`。
3. 内联主脚本定义状态、API 调用、事件绑定、`window.*` 动作。
4. `window.load` 时执行：
   - 缓存关键 DOM 引用（`cacheDomElements`）
   - 绑定事件（`bindDomEvents`）
   - 初始化 Composer（`ChatComposer.initComposer`）
   - `checkAuthStatus()`
   - 若允许访问则依次加载 `loadAgents` / `loadHistory` / `loadGroups` / `loadWorkdirOptions`
   - 注册 service worker、PWA banner 逻辑

### 初始数据来源
- `GET /api/auth-status`
- `GET /api/agents`
- `GET /api/history`
- `GET /api/groups`
- `GET /api/system/dirs`

### 用户交互
- 登录/退出：`POST /api/login`、`POST /api/logout`
- 会话：`POST /api/sessions`、`POST /api/sessions/select`、`POST /api/sessions/rename`、`POST /api/sessions/delete`、`POST /api/sessions/update`
- 消息：`POST /api/chat`、`POST /api/chat-stop`、`POST /api/chat-resume`
- 历史/清空：`GET /api/history`、`POST /api/clear`
- 智能体启停：`POST /api/session-agents`
- 工作目录：`GET /api/system/dirs`、`POST /api/workdirs/select`
- 讨论摘要：`POST /api/chat-summary`
- 提及与补全（由 `public/index.html` 主脚本负责，不在 `chat-composer.js`）：
  - 候选包含 `@all`（显示为“所有人”）和当前会话启用的智能体；
  - 输入区出现 `@` 前缀时打开 `#mentionSuggestions`；
  - 键盘行为冻结：`ArrowDown/ArrowUp` 在候选中移动，`Enter/Tab` 选中，`Escape` 关闭；
  - 分组提及预确认区 `#groupMentionPreview` 支持确认/取消并展开为多个 `@智能体名`。

### 实时依赖
- 事件模型与约束遵循 `docs/architecture/event-log-chat-runtime.md`（前端消费层契约与事件日志语义需一致）。
- WebSocket：`/api/ws/session-events`，连接打开后发送
  `{"type":"subscribe","sessionId":"<activeSessionId>","afterSeq":<lastSeenEventSeq>}`。
- 订阅 ACK：收到 `type='subscribed'` 后才视为订阅成功，并以消息中的 `latestSeq` 与本地 `lastSeenEventSeq` 取最大值。
- 增量拉取：`GET /api/sessions/:id/timeline?afterSeq=<cursor>`，仅在当前 `activeSessionId` 与 `activeSessionSyncNonce` 未变化时合并。
- 重连补偿：socket 恢复后必须用“断线前 cursor”触发一次增量补偿；若增量结果出现断档/校验失败则强制回退全量 `GET /api/sessions/:id/timeline`。
- 刷新并发约束：单次仅允许一个 in-flight timeline 刷新；并发触发时置 `pending`，前一轮结束后立即续跑。

### 鉴权假设
- 页面先探测 `authEnabled` + `authenticated`（cookie 会话）。
- 未登录时展示 `#authOverlay`，其余功能受阻。
- API 大多依赖 `credentials: 'include'`。

### 关键 DOM 功能区（需功能等价保留）
- 认证层：`#authOverlay`、`#usernameInput`、`#passwordInput`
- 消息区：`#messages`（含欢迎态、时间线、系统提示）
- Composer：`#userInput`、`#sendBtn`、`#composerPreviewBody`、`#composerPreviewStatus`
- 会话控制：`#sessionSelect`、`#sessionSelectMobile`、`#recentSessions`
- 智能体控制：`#agentsList`、`#currentAgentBar`、`#agentZeroState`
- 提及与分组提及：`#mentionSuggestions`、`#groupMentionPreview`
- 工作目录：`#workdirBar`、`#agentWorkdirRoot/#agentWorkdirLevel2/#agentWorkdirLevel3`
- 移动端交互：`#mobileComposerDrawer`、`#mobileComposerDrawerBackdrop`、`#mobileControlSheetBackdrop`
- 顶部状态与动作：`#status`、`#stopCurrentBtn`、`#stopSessionBtn`、`#activeSessionBadge`

---

## 2. `public/chat-composer.js`（聊天输入增强脚本）

### 职责
- Markdown 编辑器工具栏（粗体/斜体/代码/链接/列表等）。
- 编辑/预览双面板与移动端 Tab 切换。
- 移动端输入抽屉开合、与控制中心互斥。
- 编辑区与预览区滚动同步、预览状态（行数/字符数）更新。

### 启动/依赖
- 由聊天页在 `window.load` 后调用 `window.ChatComposer.initComposer({ input, preview })`。
- 依赖 `window.ChatMarkdown.renderMarkdownHtml` 进行预览渲染。
- 暴露全局：`window.ChatComposer`、`window.openMobileComposerDrawer`、`window.closeMobileComposerDrawer`。

### 关键 DOM（需保留）
- `#userInput`
- `#composerPreview` / `#composerPreviewBody` / `#composerPreviewStatus`
- `#mobileComposerDrawer` / `#mobileComposerDrawerBackdrop`
- `[data-md-action]`（工具栏按钮）
- `.composer-mobile-tabs__tab` + `[data-composer-panel]`

---

## 3. `public/chat-markdown.js`（聊天 Markdown 渲染脚本）

### 职责
- Markdown 到 HTML：标题、段落、引用、列表、任务列表、表格、代码块、分隔线、内联样式。
- 安全处理：白名单标签/属性、阻断 `javascript:`/`data:` 链接协议。
- UI 增强：代码块语言标识、复制代码按钮、基础语法高亮、`@`/`@@` mention 高亮。

### 启动/依赖
- 页面加载即注册 `document.click` 监听，处理 `.copy-code-btn`。
- 暴露 `window.ChatMarkdown.escapeHtml/renderMarkdownHtml` 供聊天页与 Composer 复用。

### 关键契约
- 任何消息/预览渲染必须先经过 sanitize 再输出。
- `enableMentions` 参数控制是否启用 mention 强化。

---

## 4. `public-auth/admin.html`（管理后台）

### 页面职责
- 管理员 Token 验证。
- 用户管理（增删改密）。
- 模型连接管理（增删改、连通性测试）。
- 智能体管理（增删改、执行模式 CLI/API、提示词编辑、模板预览/恢复、待生效应用）。
- 分组管理（增删改、成员配置）。
- 智能体工作目录三级联动选择。

### 启动顺序
1. 先渲染静态结构（大部分功能区默认隐藏/占位）。
2. `DOMContentLoaded`：
   - 清理 `localStorage.authAdminToken`
   - 初始化目录选择器/连接表单/执行模式
   - 绑定 group form、group list、workdir 级联事件
3. 用户输入 Token 并点击“验证”触发 `verifyToken()`。
4. 验证成功后并行加载：`loadWorkdirHierarchy`、`loadModelConnections`、`loadGroups`、`loadUsers`、`loadAgents`。

### 初始数据来源
- 验证入口：`GET /api/users`（携带 `x-admin-token`）
- 成功后按模块加载：
  - 用户：`GET /api/users`
  - 模型连接：`GET /api/model-connections`
  - 智能体：`GET /api/agents`
  - 分组：`GET /api/groups`
  - 目录：`GET /api/system/dirs`

### 用户交互 API
- 用户：`POST /api/users`、`PUT /api/users/:username/password`、`DELETE /api/users/:username`
- 模型连接：`POST/PUT/DELETE /api/model-connections*`、`POST /api/model-connections/:id/test`
- 智能体：`POST/PUT/DELETE /api/agents*`、`PUT /api/agents/:name/prompt`、`POST /api/agents/:name/prompt/restore-template`、`GET /api/agents/:name/prompt/template`、`POST /api/agents/apply-pending`
- 分组：`POST/PUT/DELETE /api/groups*`

### 实时依赖
- 无 WebSocket/SSE。
- 全部为按需请求刷新。

### 鉴权假设
- 不依赖 cookie 登录流程，核心凭据为 `x-admin-token` 请求头。
- Token 仅内存态，不落盘（页面启动会主动清理旧 localStorage 项）。

### 关键 DOM 功能区（需功能等价保留）
- Token 验证：`#adminToken`、`#authBadge`
- 用户：`#addUserCard`、`#usersContainer`、`#passwordModal`
- 模型连接：`#modelConnectionsCard`、`#connectionsContainer`
- 智能体：`#agentCard`、`#agentsContainer`、`#pendingTag`
- 智能体工作目录三级联动：`#agentWorkdirRoot`、`#agentWorkdirLevel2`、`#agentWorkdirLevel3`、`#agentWorkdirPreview`
- 分组：`#groupsCard`、`#groups-list`、`#group-modal`
- 模板提示词预览：`#promptPreviewModal`

---

## 5. `public/deps-monitor.html`（依赖监控 + 运维日志）

### 页面职责
- 展示依赖健康总览（健康/异常、检查时间）。
- 展示依赖日志列表（支持开始日期、结束日期、关键字过滤）。

### 启动顺序
1. 获取 DOM 引用。
2. 绑定按钮事件：刷新、应用过滤条件。
3. 执行 `loadStatus()`。
4. `setInterval(loadStatus, 10000)` 每 10 秒自动刷新。

### 数据来源
- `GET /api/dependencies/status`
- `GET /api/dependencies/logs?startDate=&endDate=&keyword=&limit=500`

### 实时依赖
- 无长连接；10 秒轮询刷新。

### 鉴权假设
- 页面自身无登录入口/Token 输入；默认同源访问上下文可直接请求。

### 关键 DOM 功能区
- 依赖状态：`#summary`、`#rows`
- 日志过滤与结果：`#filter-start/#filter-end/#filter-keyword`、`#log-summary`、`#log-rows`

---

## 6. `public/verbose-logs.html`（CLI Verbose 日志）

### 页面职责
- 展示“智能体 -> 日志文件 -> 文件内容”三级浏览。
- 支持切换智能体、切换日志文件、查看全文内容。

### 启动顺序
1. 获取 DOM 引用与页面状态（`selectedAgent/selectedFile`）。
2. 页面加载即执行 `loadAgents()`。
3. `loadAgents()` 首次默认选中第一个智能体；`loadLogs()` 默认选中第一份日志。
4. 选择日志后调用 `selectLog()` 拉取内容并刷新日志列表高亮。

### 数据来源
- `GET /api/verbose/agents`
- `GET /api/verbose/logs?agent=...`
- `GET /api/verbose/log-content?file=...`

### 实时依赖
- 无 WebSocket/SSE/轮询；完全按用户操作触发请求。

### 鉴权假设
- 请求带 `credentials: 'include'`，依赖同源 cookie 会话。

### 关键 DOM 功能区
- 智能体列表：`#agents`
- 日志文件列表：`#logs`
- 日志内容：`#current`、`#content`

---

## 7. 迁移映射（旧页面/脚本 -> React 模块）

| 来源页面/脚本 | 目标入口/页面/组件 | 迁移说明 |
| --- | --- | --- |
| `public/index.html` | `frontend/src/entries/chat-main.tsx` + `frontend/src/chat/pages/ChatPage.tsx` | 用 React 正式接管页面壳与状态，不再依赖内联 Babel/UMD。 |
| `public/index.html`（会话/智能体/目录/消息区） | `frontend/src/chat/features/session-sidebar/*` + `message-list/*` + `timeline-panel/*` | 保留核心交互契约（会话切换、时间线渲染、call graph 展开、移动端镜像面板）。 |
| `public/index.html`（API + 实时逻辑） | `frontend/src/chat/services/chat-api.ts` + `chat-realtime.ts` | 抽离 fetch + WebSocket + 增量补偿逻辑，避免 UI 文件内耦合。 |
| `public/index.html`（mention/autocomplete 与输入键盘路由） | `frontend/src/chat/features/composer/*` + `session-sidebar/*` | `@all`/智能体建议、`#mentionSuggestions`、`#groupMentionPreview`、`ArrowUp/ArrowDown/Enter/Tab/Escape` 行为当前在 `index.html`，迁移时需原位保留。 |
| `public/chat-composer.js` | `frontend/src/chat/features/composer/*` | 保留 Markdown 工具栏、预览、移动抽屉、滚动同步（不负责 mention 候选与键盘路由）。 |
| `public/chat-markdown.js` | `frontend/src/chat/features/message-list/*` +（可复用到 shared markdown util） | 渲染/净化/代码块复制/mention 高亮作为明确可测试能力迁移。 |
| `public-auth/admin.html` | `frontend/src/entries/admin-main.tsx` + `frontend/src/admin/pages/AdminPage.tsx` + `frontend/src/admin/features/*` | 以模块化功能区重建：Token 门禁、用户、连接、智能体、分组、workdir 级联。 |
| `public/deps-monitor.html` | `frontend/src/entries/deps-monitor-main.tsx` + `frontend/src/ops/pages/DepsMonitorPage.tsx` | 保留“依赖总览 + 日志过滤 + 10 秒轮询”功能契约。 |
| `public/verbose-logs.html` | `frontend/src/entries/verbose-logs-main.tsx` + `frontend/src/ops/pages/VerboseLogsPage.tsx` | 保留三级浏览路径与默认首项自动选中行为。 |

## 8. 迁移期间的不可回归点（Checklist）
- 聊天页面在“未认证 + 启用鉴权”场景必须阻止发送并展示登录入口。
- 会话时间线必须支持“全量 + 增量(afterSeq) + 重连补偿”链路。
- Markdown 渲染必须先 sanitize，再渲染增强（代码复制/mention）。
- 管理后台仍须以 `x-admin-token` 为主鉴权，不引入隐式持久化 token。
- ops 两页保持独立入口，并可互相跳转。
