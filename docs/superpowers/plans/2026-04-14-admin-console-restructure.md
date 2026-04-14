# Admin Console Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin console into a light, modern, multi-page management experience with a navigation-first home page and separate list/edit screens for agents, groups, users, and model connections.

**Architecture:** Replace the current single `AdminPage` workspace with a lightweight client-side admin shell that owns token gating, shared resource loading, and route state, then render each admin function as an isolated page module. Reuse the existing admin API contracts, preserve the current auth model, and extend the built frontend shell plus admin server static fallback so deep links like `/admin/agents` and `/admin/users/alice/edit` resolve to the same SPA entry.

**Tech Stack:** React 18, TypeScript, Vite multi-page frontend build, existing shared UI/theme tokens, Node integration tests with `node:test`, existing auth-admin HTTP routes.

---

## Product Intent And Acceptance Criteria

### UX goals
- 管理首页不是编辑器，而是轻量导航页。
- 视觉延续聊天区：精致、柔和、现代、内容感强，避免传统后台大盘味和厚重卡片感。
- 编辑页必须是独立页面，不能使用抽屉。
- 控制信息弱化，内容与操作路径更直接，减少解释型文案。
- 移动端优先保证信息完整显示，不允许出现必须横向拖动才能看全核心内容的情况。

### Functional acceptance
- `/admin` 展示轻概览、功能导航、待处理、最近改动。
- `/admin/agents|groups|users|model-connections` 均有各自列表页。
- `/new` 与 `/:id/edit` 页面均为独立页面，可直接刷新进入。
- 顶部管理壳层保持轻量、紧凑、吸顶，操作图标化。
- 深链刷新时，服务端仍返回同一个 admin shell。
- 现有 token gate、admin API、创建/更新/删除能力保持可用。

### Non-goals
- 本次不重做 admin 后端 API 设计。
- 本次不引入重量级路由库或状态管理库，除非实现过程中被证明必要。
- 本次不把首页做成传统数据大屏。

## File Structure

### Existing files to keep but refactor
- `frontend/src/entries/admin-main.tsx` — current admin entry; will mount the new router-driven admin app instead of `AdminPage` directly.
- `frontend/src/admin/pages/AdminPage.tsx` — current monolithic admin page; will become a thin compatibility wrapper or be removed after route migration.
- `frontend/src/admin/services/admin-api.ts` — keep API contracts; extend only if page-level fetching needs helper methods.
- `frontend/src/admin/types/index.ts` — keep shared admin domain types; add route/view-model types only if they are broadly reused.
- `frontend/src/shared/layouts/AppShell.tsx` — shared shell; may need tighter header spacing and icon-first actions consistent with chat refinements.
- `frontend/src/shared/layouts/ToolPageLayout.tsx` — may need lighter content framing for list/edit admin pages.
- `frontend/src/shared/styles/base.css` — add global admin layout primitives and responsive rules.
- `src/shared/http/frontend-asset-resolver.ts` — extend to serve the admin SPA entry for `/admin` nested routes.
- `src/admin/http/auth-admin-routes.ts` — pass the new admin SPA entry paths to frontend asset resolution.
- `tests/integration/admin-frontend-shell.integration.test.js` — broaden from single-page shell checks to multi-route admin shell checks.
- `tests/integration/admin-page-agent-prompt.integration.test.js` — update assertions that still expect the old section-based `AdminPage` layout.

### New frontend app-shell and routing files
- `frontend/src/admin/app/AdminApp.tsx` — root admin app composition; wires theme, auth gate, shared resource store, route rendering, notices.
- `frontend/src/admin/app/admin-router.ts` — lightweight browser-history router for `/admin` and nested routes without adding `react-router`.
- `frontend/src/admin/app/admin-routes.ts` — typed route matching/build helpers for dashboard, list, new, and edit pages.
- `frontend/src/admin/app/AdminLayout.tsx` — shared sticky admin header, right-side icon actions, page-level content slot.
- `frontend/src/admin/app/AdminContext.tsx` — shared admin resource loading/mutation context replacing state trapped in the old `AdminPage`.
- `frontend/src/admin/app/AdminNoticeRegion.tsx` — lightweight global success/error notice presenter.

### New shared admin UI files
- `frontend/src/admin/components/AdminHomeHero.tsx`
- `frontend/src/admin/components/AdminSectionNav.tsx`
- `frontend/src/admin/components/AdminStatStrip.tsx`
- `frontend/src/admin/components/AdminActivityFeed.tsx`
- `frontend/src/admin/components/AdminListPageHeader.tsx`
- `frontend/src/admin/components/AdminDataList.tsx`
- `frontend/src/admin/components/AdminEmptyBlock.tsx`
- `frontend/src/admin/components/AdminFormPage.tsx`
- `frontend/src/admin/components/AdminFieldGroup.tsx`
- `frontend/src/admin/components/AdminIconButton.tsx`
- `frontend/src/admin/components/AdminEntityChip.tsx`

### New page files
- `frontend/src/admin/pages/AdminDashboardPage.tsx`
- `frontend/src/admin/pages/AgentsListPage.tsx`
- `frontend/src/admin/pages/AgentCreatePage.tsx`
- `frontend/src/admin/pages/AgentEditPage.tsx`
- `frontend/src/admin/pages/GroupsListPage.tsx`
- `frontend/src/admin/pages/GroupCreatePage.tsx`
- `frontend/src/admin/pages/GroupEditPage.tsx`
- `frontend/src/admin/pages/UsersListPage.tsx`
- `frontend/src/admin/pages/UserCreatePage.tsx`
- `frontend/src/admin/pages/UserEditPage.tsx`
- `frontend/src/admin/pages/ModelConnectionsListPage.tsx`
- `frontend/src/admin/pages/ModelConnectionCreatePage.tsx`
- `frontend/src/admin/pages/ModelConnectionEditPage.tsx`
- `frontend/src/admin/pages/AdminNotFoundPage.tsx`

### New feature-specific reusable modules
- `frontend/src/admin/features/agents/agent-form.ts` — normalize/validate agent form payloads.
- `frontend/src/admin/features/agents/AgentForm.tsx`
- `frontend/src/admin/features/agents/AgentList.tsx`
- `frontend/src/admin/features/groups/group-form.ts`
- `frontend/src/admin/features/groups/GroupForm.tsx`
- `frontend/src/admin/features/groups/GroupList.tsx`
- `frontend/src/admin/features/users/user-form.ts`
- `frontend/src/admin/features/users/UserForm.tsx`
- `frontend/src/admin/features/users/UserList.tsx`
- `frontend/src/admin/features/model-connections/model-connection-form.ts`
- `frontend/src/admin/features/model-connections/ModelConnectionForm.tsx`
- `frontend/src/admin/features/model-connections/ModelConnectionList.tsx`

### Test files to add
- `tests/integration/admin-routing-shell.integration.test.js` — shell/deep-link coverage for `/admin`, nested list pages, and edit pages.
- `tests/unit/admin-router.unit.test.js` — route parsing/building coverage.
- `tests/unit/admin-form-models.unit.test.js` — pure validation/normalization coverage for agent/group/user/model-connection forms.

## Route Matrix

| Path | Purpose | Primary module |
| --- | --- | --- |
| `/admin` | 轻概览首页 | `AdminDashboardPage.tsx` |
| `/admin/agents` | 智能体列表 | `AgentsListPage.tsx` |
| `/admin/agents/new` | 新建智能体 | `AgentCreatePage.tsx` |
| `/admin/agents/:name/edit` | 编辑智能体 | `AgentEditPage.tsx` |
| `/admin/groups` | 分组列表 | `GroupsListPage.tsx` |
| `/admin/groups/new` | 新建分组 | `GroupCreatePage.tsx` |
| `/admin/groups/:id/edit` | 编辑分组 | `GroupEditPage.tsx` |
| `/admin/users` | 用户列表 | `UsersListPage.tsx` |
| `/admin/users/new` | 新建用户 | `UserCreatePage.tsx` |
| `/admin/users/:name/edit` | 编辑用户 | `UserEditPage.tsx` |
| `/admin/model-connections` | 模型连接列表 | `ModelConnectionsListPage.tsx` |
| `/admin/model-connections/new` | 新建模型连接 | `ModelConnectionCreatePage.tsx` |
| `/admin/model-connections/:id/edit` | 编辑模型连接 | `ModelConnectionEditPage.tsx` |

## Data Ownership

- `AdminContext.tsx` 负责：
  - token gate 状态
  - 首次并行拉取 users / agents / groups / connections
  - 全局 notice
  - 页面间共享的 mutation 封装与资源刷新
- 各页面负责：
  - 读取路由参数
  - 本页筛选、排序、提交、返回逻辑
  - 局部 loading / empty / error 呈现
- `admin-routes.ts` 只负责纯函数式路径匹配和路径生成，禁止耦合 UI。

## Migration Strategy

1. 先建立新壳层与路由，不立即删除旧 `AdminPage`。
2. 首页先落地为 `/admin`，确认基础布局正确。
3. 再按模块逐个把 agents / groups / users / model-connections 从面板式结构迁移为列表页 + 编辑页。
4. 所有新页面稳定后，再让 `AdminPage` 退化为兼容包装器或彻底退出入口链路。
5. 最后清理旧 section-based 测试断言与遗留样式。

## Risks And Guardrails

- **风险：** 当前仓库已有聊天区未提交改动，可能与共享样式文件冲突。  
  **约束：** 实施时必须在隔离 worktree 中执行，避免污染主工作区。
- **风险：** `AppShell` 与 `base.css` 是共享基础设施，改动可能影响聊天页。  
  **约束：** 优先新增 admin 专属 class，避免粗暴覆盖通用样式。
- **风险：** 旧集成测试仍假设存在 `#agents/#groups/#model-connections` 同页 section。  
  **约束：** 在迁移后同步更新测试，不允许保留已失效断言。
- **风险：** 移动端列表页容易再次出现宽度溢出。  
  **约束：** 列表与表单组件需要明确 `min-width: 0`、换行策略、移动端栅格规则。

---

### Task 1: Establish the multi-page admin IA and route contract

**Files:**
- Create: `frontend/src/admin/app/admin-routes.ts`
- Create: `frontend/src/admin/app/admin-router.ts`
- Test: `tests/unit/admin-router.unit.test.js`

- [ ] **Step 1: Write the failing router unit tests for all required admin URLs**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchAdminRoute, buildAdminPath } = require('../../frontend/src/admin/app/admin-routes.ts');

test('admin routes cover dashboard, list, create, and edit pages', () => {
  assert.deepEqual(matchAdminRoute('/admin/agents'), { section: 'agents', view: 'list' });
  assert.deepEqual(matchAdminRoute('/admin/agents/new'), { section: 'agents', view: 'create' });
  assert.deepEqual(matchAdminRoute('/admin/agents/Alice/edit'), {
    section: 'agents',
    view: 'edit',
    params: { name: 'Alice' }
  });
  assert.equal(buildAdminPath({ section: 'groups', view: 'create' }), '/admin/groups/new');
});
```

- [ ] **Step 2: Run the new router test and confirm it fails because the route helpers do not exist yet**

Run: `node --test tests/unit/admin-router.unit.test.js`
Expected: FAIL with module/file-not-found or missing export errors for `matchAdminRoute` / `buildAdminPath`.

- [ ] **Step 3: Implement the minimal route matcher/builder and browser-history subscription**

```ts
export type AdminRoute =
  | { section: 'dashboard'; view: 'home' }
  | { section: 'agents'; view: 'list' }
  | { section: 'agents'; view: 'create' }
  | { section: 'agents'; view: 'edit'; params: { name: string } }
  | { section: 'groups'; view: 'list' }
  | { section: 'groups'; view: 'create' }
  | { section: 'groups'; view: 'edit'; params: { id: string } }
  | { section: 'users'; view: 'list' }
  | { section: 'users'; view: 'create' }
  | { section: 'users'; view: 'edit'; params: { name: string } }
  | { section: 'model-connections'; view: 'list' }
  | { section: 'model-connections'; view: 'create' }
  | { section: 'model-connections'; view: 'edit'; params: { id: string } }
  | { section: 'not-found'; view: '404'; pathname: string };
```

- [ ] **Step 4: Re-run the unit test and verify it passes**

Run: `node --test tests/unit/admin-router.unit.test.js`
Expected: PASS with route coverage for dashboard/list/create/edit paths.

- [ ] **Step 5: Commit the routing contract**

```bash
git add frontend/src/admin/app/admin-routes.ts frontend/src/admin/app/admin-router.ts tests/unit/admin-router.unit.test.js
git commit -m "feat: define admin console route contract"
```

### Task 2: Make the admin shell resolve deep links and mount the new root app

**Files:**
- Modify: `frontend/src/entries/admin-main.tsx`
- Create: `frontend/src/admin/app/AdminApp.tsx`
- Create: `frontend/src/admin/app/AdminLayout.tsx`
- Create: `frontend/src/admin/app/AdminContext.tsx`
- Create: `frontend/src/admin/app/AdminNoticeRegion.tsx`
- Modify: `src/shared/http/frontend-asset-resolver.ts`
- Modify: `src/admin/http/auth-admin-routes.ts`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`
- Create: `tests/integration/admin-routing-shell.integration.test.js`

- [ ] **Step 1: Add failing integration coverage for nested admin URLs returning the admin shell**

```js
test('admin nested routes return the same built shell', async () => {
  const fixture = await createAuthAdminFixture();
  try {
    const urls = ['/admin', '/admin/agents', '/admin/users/alice/edit'];
    const responses = await Promise.all(urls.map((pathname) => fetch(`http://127.0.0.1:${fixture.port}${pathname}`)));
    const html = await Promise.all(responses.map((response) => response.text()));
    assert.equal(responses[0].status, 200);
    assert.match(html[0], /agent-co-page" content="admin"/);
    assert.equal(html[1], html[0]);
    assert.equal(html[2], html[0]);
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted integration test and confirm `/admin/...` deep links currently fail**

Run: `node --test tests/integration/admin-frontend-shell.integration.test.js tests/integration/admin-routing-shell.integration.test.js`
Expected: FAIL with 404/route-miss for nested admin URLs.

- [ ] **Step 3: Implement `AdminApp` with shared auth token gate, shared resource loading, route state, and global notice plumbing**

```tsx
export function AdminApp() {
  const router = useAdminRouter();
  return (
    <AdminContextProvider>
      <AdminLayout route={router.route} onNavigate={router.navigate}>
        <AdminRouteView route={router.route} onNavigate={router.navigate} />
      </AdminLayout>
      <AdminNoticeRegion />
    </AdminContextProvider>
  );
}
```

- [ ] **Step 4: Extend frontend asset resolution so `/admin` and all known nested admin routes serve `admin.html`**

```ts
const entryPaths = ['/', '/index.html', '/admin.html', '/admin'];
if (pathname === '/admin' || pathname.startsWith('/admin/')) {
  return { filePath: entryHtmlFile, required: true };
}
```

- [ ] **Step 5: Re-run the integration tests and verify shell/deep-link coverage passes**

Run: `node --test tests/integration/admin-frontend-shell.integration.test.js tests/integration/admin-routing-shell.integration.test.js`
Expected: PASS; `/`, `/admin`, and nested admin routes all serve the same admin shell.

- [ ] **Step 6: Commit the admin shell foundation**

```bash
git add frontend/src/entries/admin-main.tsx frontend/src/admin/app/AdminApp.tsx frontend/src/admin/app/AdminLayout.tsx frontend/src/admin/app/AdminContext.tsx frontend/src/admin/app/AdminNoticeRegion.tsx src/shared/http/frontend-asset-resolver.ts src/admin/http/auth-admin-routes.ts tests/integration/admin-frontend-shell.integration.test.js tests/integration/admin-routing-shell.integration.test.js
git commit -m "feat: add routed admin shell"
```

### Task 3: Build the light dashboard-style admin home page (C direction)

**Files:**
- Create: `frontend/src/admin/pages/AdminDashboardPage.tsx`
- Create: `frontend/src/admin/components/AdminHomeHero.tsx`
- Create: `frontend/src/admin/components/AdminSectionNav.tsx`
- Create: `frontend/src/admin/components/AdminStatStrip.tsx`
- Create: `frontend/src/admin/components/AdminActivityFeed.tsx`
- Modify: `frontend/src/shared/layouts/AppShell.tsx`
- Modify: `frontend/src/shared/layouts/ToolPageLayout.tsx`
- Modify: `frontend/src/shared/styles/base.css`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add a failing integration assertion for the new dashboard navigation structure**

```js
test('authenticated admin dashboard renders lightweight overview and navigation', async () => {
  const renderer = await renderAdminPage({
    api: fakeApi,
    initialAuthToken: 'token-123',
    initialPathname: '/admin'
  });
  assert.match(renderer.toJSON().children.join(' '), /智能体|分组|用户|模型连接/);
  assert.match(renderer.toJSON().children.join(' '), /待处理|最近改动/);
});
```

- [ ] **Step 2: Run the admin frontend shell test and confirm the dashboard content does not exist yet**

Run: `node --test --test-name-pattern='dashboard|authenticated admin' tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL because the old page still renders section-stacked workspace content.

- [ ] **Step 3: Implement the dashboard page with four light regions: hero, quick stats, feature navigation, activity/pending feed**

```tsx
<main className="admin-dashboard">
  <AdminHomeHero title="管理台" subtitle="轻量概览与配置入口" />
  <AdminStatStrip items={[...]}/>
  <AdminSectionNav items={[...]}/>
  <AdminActivityFeed pending={pendingAgents} recentItems={recentItems} />
</main>
```

- [ ] **Step 3.1: Encode lightweight content rules directly in the page implementation**

```tsx
const quickNavItems = [
  { key: 'agents', label: '智能体', meta: `${resources.agents.length} 项`, href: '/admin/agents' },
  { key: 'groups', label: '分组', meta: `${resources.groups.length} 项`, href: '/admin/groups' },
  { key: 'users', label: '用户', meta: `${resources.users.length} 项`, href: '/admin/users' },
  { key: 'model-connections', label: '模型连接', meta: `${resources.connections.length} 项`, href: '/admin/model-connections' }
];
```

- [ ] **Step 4: Tune shared spacing/styles so the admin header is light, content-led, and consistent with the chat redesign**

Run: `npm run build`
Expected: PASS and no TypeScript errors from the new admin shell layout.

- [ ] **Step 5: Commit the dashboard page**

```bash
git add frontend/src/admin/pages/AdminDashboardPage.tsx frontend/src/admin/components/AdminHomeHero.tsx frontend/src/admin/components/AdminSectionNav.tsx frontend/src/admin/components/AdminStatStrip.tsx frontend/src/admin/components/AdminActivityFeed.tsx frontend/src/shared/layouts/AppShell.tsx frontend/src/shared/layouts/ToolPageLayout.tsx frontend/src/shared/styles/base.css tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: add admin dashboard home"
```

### Task 4: Replace the agents workspace panel with separate list/create/edit pages

**Files:**
- Create: `frontend/src/admin/pages/AgentsListPage.tsx`
- Create: `frontend/src/admin/pages/AgentCreatePage.tsx`
- Create: `frontend/src/admin/pages/AgentEditPage.tsx`
- Create: `frontend/src/admin/features/agents/agent-form.ts`
- Create: `frontend/src/admin/features/agents/AgentForm.tsx`
- Create: `frontend/src/admin/features/agents/AgentList.tsx`
- Modify: `frontend/src/admin/features/agents/AgentManagementPanel.tsx`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`
- Create: `tests/unit/admin-form-models.unit.test.js`

- [ ] **Step 1: Add failing unit coverage for agent form normalization and page-mode differences**

```js
test('agent form trims string fields and removes API-only fields in CLI mode', () => {
  const result = normalizeAgentDraft({
    name: ' Alice ',
    workdir: ' /workspace/demo ',
    executionMode: 'cli',
    apiConnectionId: 'primary'
  });
  assert.equal(result.name, 'Alice');
  assert.equal(result.workdir, '/workspace/demo');
  assert.equal(result.apiConnectionId, undefined);
});
```

- [ ] **Step 2: Run the agent form unit test and confirm the normalization helper is missing**

Run: `node --test --test-name-pattern='agent form' tests/unit/admin-form-models.unit.test.js`
Expected: FAIL with missing file/export errors.

- [ ] **Step 3: Build the agents list page and dedicated form pages, reusing current API contracts but removing inline drawer/panel editing**

```tsx
export function AgentsListPage() {
  return <AgentList agents={resources.agents} onCreate={() => navigate('/admin/agents/new')} onEdit={(name) => navigate(`/admin/agents/${encodeURIComponent(name)}/edit`)} />;
}

export function AgentCreatePage() {
  return <AgentForm mode="create" onSubmit={saveAgent} />;
}
```

- [ ] **Step 3.1: Keep review-sensitive fields grouped and explicit**

```tsx
<AdminFieldGroup title="基础信息">
  <Input name="agent-name" />
  <Input name="agent-avatar" />
  <Input name="agent-color" />
</AdminFieldGroup>
<AdminFieldGroup title="执行配置">
  <select name="agent-executionMode" />
  <Input name="agent-workdir" />
  <textarea name="agent-systemPrompt" />
</AdminFieldGroup>
```

- [ ] **Step 4: Re-run agent unit/integration coverage to verify list/create/edit flows render correctly**

Run: `node --test --test-name-pattern='agent form|agents' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS for agent draft normalization and rendered page shells.

- [ ] **Step 5: Commit the agents page split**

```bash
git add frontend/src/admin/pages/AgentsListPage.tsx frontend/src/admin/pages/AgentCreatePage.tsx frontend/src/admin/pages/AgentEditPage.tsx frontend/src/admin/features/agents/agent-form.ts frontend/src/admin/features/agents/AgentForm.tsx frontend/src/admin/features/agents/AgentList.tsx frontend/src/admin/features/agents/AgentManagementPanel.tsx tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: split admin agents into separate pages"
```

### Task 5: Split groups into dedicated list/create/edit pages

**Files:**
- Create: `frontend/src/admin/pages/GroupsListPage.tsx`
- Create: `frontend/src/admin/pages/GroupCreatePage.tsx`
- Create: `frontend/src/admin/pages/GroupEditPage.tsx`
- Create: `frontend/src/admin/features/groups/group-form.ts`
- Create: `frontend/src/admin/features/groups/GroupForm.tsx`
- Create: `frontend/src/admin/features/groups/GroupList.tsx`
- Modify: `frontend/src/admin/features/groups/GroupManagementPanel.tsx`
- Modify: `tests/unit/admin-form-models.unit.test.js`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add failing tests for group member validation and edit-route rendering**

```js
test('group form rejects duplicate or unknown agent members', () => {
  assert.throws(
    () => normalizeGroupDraft({ id: 'core', agentNames: ['Alice', 'Alice', 'Ghost'] }, ['Alice']),
    /重复智能体|未知智能体/
  );
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail before implementation**

Run: `node --test --test-name-pattern='group form|groups' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL because group page modules do not exist.

- [ ] **Step 3: Implement the groups list and standalone create/edit pages using chip-style member display and concise page framing**

```tsx
<GroupForm
  availableAgents={resources.agents}
  initialValue={existingGroup}
  onSubmit={async (draft) => {
    await saveGroup(draft);
    navigate('/admin/groups');
  }}
/>
```

- [ ] **Step 3.1: Ensure member selection remains mobile-safe**

Run: `npm run build`
Expected: PASS; no TypeScript or JSX errors after introducing chip-style group member UI.

- [ ] **Step 4: Re-run group tests and verify they pass**

Run: `node --test --test-name-pattern='group form|groups' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the groups page split**

```bash
git add frontend/src/admin/pages/GroupsListPage.tsx frontend/src/admin/pages/GroupCreatePage.tsx frontend/src/admin/pages/GroupEditPage.tsx frontend/src/admin/features/groups/group-form.ts frontend/src/admin/features/groups/GroupForm.tsx frontend/src/admin/features/groups/GroupList.tsx frontend/src/admin/features/groups/GroupManagementPanel.tsx tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: split admin groups into separate pages"
```

### Task 6: Split users into dedicated list/create/edit pages

**Files:**
- Create: `frontend/src/admin/pages/UsersListPage.tsx`
- Create: `frontend/src/admin/pages/UserCreatePage.tsx`
- Create: `frontend/src/admin/pages/UserEditPage.tsx`
- Create: `frontend/src/admin/features/users/user-form.ts`
- Create: `frontend/src/admin/features/users/UserForm.tsx`
- Create: `frontend/src/admin/features/users/UserList.tsx`
- Modify: `frontend/src/admin/features/users/UserManagementPanel.tsx`
- Modify: `tests/unit/admin-form-models.unit.test.js`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add failing tests for user create/password-edit normalization and page route rendering**

```js
test('user form trims username and only sends password when provided', () => {
  const result = normalizeUserDraft({ username: ' demo ', password: 'secret' });
  assert.equal(result.username, 'demo');
  assert.equal(result.password, 'secret');
});
```

- [ ] **Step 2: Run the targeted user tests and verify they fail first**

Run: `node --test --test-name-pattern='user form|users' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement users list/create/edit pages with a light credential-edit experience on its own page instead of inline panel controls**

```tsx
export function UserEditPage() {
  return (
    <UserForm
      mode="edit"
      initialValue={{ username }}
      onSubmit={async ({ password }) => api.updateUserPassword(username, { password })}
    />
  );
}
```

- [ ] **Step 3.1: Keep password editing copy minimal**

```tsx
<AdminFormPage
  title={mode === 'create' ? '新建用户' : username}
  description={mode === 'create' ? undefined : '仅在需要时更新密码'}
/>
```

- [ ] **Step 4: Re-run the user tests and verify they pass**

Run: `node --test --test-name-pattern='user form|users' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the users page split**

```bash
git add frontend/src/admin/pages/UsersListPage.tsx frontend/src/admin/pages/UserCreatePage.tsx frontend/src/admin/pages/UserEditPage.tsx frontend/src/admin/features/users/user-form.ts frontend/src/admin/features/users/UserForm.tsx frontend/src/admin/features/users/UserList.tsx frontend/src/admin/features/users/UserManagementPanel.tsx tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: split admin users into separate pages"
```

### Task 7: Split model connections into dedicated list/create/edit pages

**Files:**
- Create: `frontend/src/admin/pages/ModelConnectionsListPage.tsx`
- Create: `frontend/src/admin/pages/ModelConnectionCreatePage.tsx`
- Create: `frontend/src/admin/pages/ModelConnectionEditPage.tsx`
- Create: `frontend/src/admin/features/model-connections/model-connection-form.ts`
- Create: `frontend/src/admin/features/model-connections/ModelConnectionForm.tsx`
- Create: `frontend/src/admin/features/model-connections/ModelConnectionList.tsx`
- Modify: `frontend/src/admin/features/model-connections/ModelConnectionManagementPanel.tsx`
- Modify: `tests/unit/admin-form-models.unit.test.js`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add failing tests for model-connection draft normalization and edit-page rendering**

```js
test('model connection form trims baseURL and preserves enabled state', () => {
  const result = normalizeModelConnectionDraft({
    name: 'Primary',
    baseURL: ' https://api.example.test/ ',
    enabled: true
  });
  assert.equal(result.baseURL, 'https://api.example.test/');
  assert.equal(result.enabled, true);
});
```

- [ ] **Step 2: Run the targeted model-connection tests and confirm they fail first**

Run: `node --test --test-name-pattern='model connection|connections' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement model-connection list/create/edit pages, including test-connection action placement on the dedicated edit page**

```tsx
<ModelConnectionForm
  mode="edit"
  initialValue={existingConnection}
  onTest={async () => setTestResult(await api.testModelConnection(connection.id))}
  onSubmit={saveConnection}
/>
```

- [ ] **Step 3.1: Keep connection metadata secondary, not primary**

```tsx
<AdminDataList
  items={connections}
  renderMeta={(item) => [item.baseURL, item.enabled ? '已启用' : '已停用']}
/>
```

- [ ] **Step 4: Re-run the model-connection tests and verify they pass**

Run: `node --test --test-name-pattern='model connection|connections' tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the model-connections page split**

```bash
git add frontend/src/admin/pages/ModelConnectionsListPage.tsx frontend/src/admin/pages/ModelConnectionCreatePage.tsx frontend/src/admin/pages/ModelConnectionEditPage.tsx frontend/src/admin/features/model-connections/model-connection-form.ts frontend/src/admin/features/model-connections/ModelConnectionForm.tsx frontend/src/admin/features/model-connections/ModelConnectionList.tsx frontend/src/admin/features/model-connections/ModelConnectionManagementPanel.tsx tests/unit/admin-form-models.unit.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "feat: split admin model connections into separate pages"
```

### Task 8: Remove the old stacked workspace assumptions and update compatibility tests

**Files:**
- Modify: `frontend/src/admin/pages/AdminPage.tsx`
- Modify: `tests/integration/admin-page-agent-prompt.integration.test.js`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add a failing assertion that the admin source no longer depends on stacked `#agents/#groups/#model-connections` sections**

```js
assert.doesNotMatch(adminPageSource, /<section id="agents"/);
assert.match(adminPageSource, /return <AdminApp/);
```

- [ ] **Step 2: Run the compatibility integration tests and verify they fail while old assumptions remain**

Run: `node --test tests/integration/admin-page-agent-prompt.integration.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL because tests/source still reference the old monolithic workspace.

- [ ] **Step 3: Convert `AdminPage` into a thin compatibility wrapper or remove it from the entry path entirely, then rewrite integration assertions around routed pages**

```tsx
export function AdminPage(props: AdminPageProps) {
  return <AdminApp {...props} />;
}
```

- [ ] **Step 4: Re-run the compatibility integration tests and verify they pass against the routed admin shell**

Run: `node --test tests/integration/admin-page-agent-prompt.integration.test.js tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the cleanup of old admin-page assumptions**

```bash
git add frontend/src/admin/pages/AdminPage.tsx tests/integration/admin-page-agent-prompt.integration.test.js tests/integration/admin-frontend-shell.integration.test.js
git commit -m "refactor: remove monolithic admin workspace assumptions"
```

### Task 9: Finish responsive polish, empty states, and visual consistency with the chat redesign

**Files:**
- Create: `frontend/src/admin/components/AdminListPageHeader.tsx`
- Create: `frontend/src/admin/components/AdminDataList.tsx`
- Create: `frontend/src/admin/components/AdminEmptyBlock.tsx`
- Create: `frontend/src/admin/components/AdminFormPage.tsx`
- Create: `frontend/src/admin/components/AdminFieldGroup.tsx`
- Create: `frontend/src/admin/components/AdminIconButton.tsx`
- Create: `frontend/src/admin/components/AdminEntityChip.tsx`
- Modify: `frontend/src/shared/styles/base.css`
- Modify: `frontend/src/shared/ui/Table.tsx`
- Modify: `tests/integration/admin-frontend-shell.integration.test.js`

- [ ] **Step 1: Add failing integration assertions for mobile-friendly admin list/form framing and icon-first controls**

```js
test('admin pages keep icon-first actions and mobile-safe content widths', async () => {
  const renderer = await renderAdminPage({ api: fakeApi, initialAuthToken: 'token-123', initialPathname: '/admin/agents' });
  const tree = JSON.stringify(renderer.toJSON());
  assert.match(tree, /data-admin-action="create-agent"/);
  assert.match(tree, /data-admin-layout="list-page"/);
});
```

- [ ] **Step 2: Run the integration test and confirm the UI primitives are still missing**

Run: `node --test --test-name-pattern='mobile-safe|icon-first' tests/integration/admin-frontend-shell.integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the reusable admin UI primitives and CSS tokens for lighter surfaces, compact headers, and full-width mobile content without heavy card styling**

Run: `npm run build`
Expected: PASS; admin pages compile with the shared primitives and updated layout styles.

- [ ] **Step 4: Re-run the targeted integration assertions and verify they pass**

Run: `node --test --test-name-pattern='mobile-safe|icon-first' tests/integration/admin-frontend-shell.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the admin polish layer**

```bash
git add frontend/src/admin/components/AdminListPageHeader.tsx frontend/src/admin/components/AdminDataList.tsx frontend/src/admin/components/AdminEmptyBlock.tsx frontend/src/admin/components/AdminFormPage.tsx frontend/src/admin/components/AdminFieldGroup.tsx frontend/src/admin/components/AdminIconButton.tsx frontend/src/admin/components/AdminEntityChip.tsx frontend/src/shared/styles/base.css frontend/src/shared/ui/Table.tsx tests/integration/admin-frontend-shell.integration.test.js
git commit -m "style: polish admin console layouts"
```

### Task 10: Run full verification and document rollout risks

**Files:**
- Modify: `docs/superpowers/plans/2026-04-14-admin-console-restructure.md`

- [ ] **Step 1: Run focused unit and integration coverage for the new admin shell**

Run: `node --test tests/unit/admin-router.unit.test.js tests/unit/admin-form-models.unit.test.js tests/integration/admin-routing-shell.integration.test.js tests/integration/admin-frontend-shell.integration.test.js tests/integration/admin-page-agent-prompt.integration.test.js`
Expected: PASS.

- [ ] **Step 2: Run the frontend build and repo build**

Run: `cd frontend && npm run build && cd /root/chat && npm run build`
Expected: PASS; `dist/frontend/admin.html` and backend TypeScript build artifacts regenerate successfully.

- [ ] **Step 3: Run the broader admin/auth integration suite to catch server regressions**

Run: `node --test tests/integration/auth-admin-server.integration.test.js`
Expected: PASS.

- [ ] **Step 4: Review manual QA checklist before merging**

```text
- Visit /admin and confirm dashboard renders with light overview + navigation.
- Visit /admin/agents, /admin/groups, /admin/users, /admin/model-connections.
- Confirm each list page navigates to /new and /:id/edit routes.
- Refresh on a deep link and confirm the SPA shell still loads.
- Verify mobile width does not clip list rows or form fields.
- Verify token gate still blocks unauthenticated admin access.
```

- [ ] **Step 5: Commit any final verification-only updates or plan notes**

```bash
git add docs/superpowers/plans/2026-04-14-admin-console-restructure.md
git commit -m "docs: finalize admin console restructure plan status"
```

---

## Notes for the implementing worker
- Prefer a lightweight custom router over adding `react-router`, unless route complexity materially increases during implementation.
- Keep the admin home page light: quick understanding, quick navigation, minimal text, no heavy dashboard chrome.
- Avoid drawer-based editing in admin; all create/edit work belongs on standalone pages.
- Preserve existing API contracts unless a backend change is truly required; this is primarily an IA/UI refactor.
- Reuse chat-page lessons: compact sticky header, content-first spacing, minimal helper copy, mobile-safe widths, soft surfaces instead of heavy stacked cards.
- If implementation begins in a repo with unrelated uncommitted work, do not reuse that workspace directly; create a worktree first and keep the current workspace untouched.
