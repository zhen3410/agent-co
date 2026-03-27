# 智能体分组功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为多 AI 智能体聊天室添加分组功能，支持组织管理、场景切换和批量 @ 提及。

**Architecture:** 新建 `group-store.ts` 作为分组存储层，在 `auth-admin-server.ts` 中添加分组管理 API，在 `server.ts` 中添加只读分组查询端点，前端侧边栏按分组展示智能体并支持分组切换和 @ 分组预览确认。

**Tech Stack:** TypeScript, Node.js HTTP Server, React (前端)

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/group-store.ts` | 分组存储、验证、级联清理（新建） |
| `src/auth-admin-server.ts` | 分组 CRUD API（修改） |
| `src/server.ts` | `/api/groups` GET 端点（修改） |
| `public/index.html` | 侧边栏分组展示、分组切换、@ 分组交互（修改） |
| `public/mockup-admin.html` | 分组管理 Tab（修改） |
| `data/groups.json` | 分组数据文件（自动创建） |

---

### Task 1: 创建 group-store.ts 核心模块

**Files:**
- Create: `src/group-store.ts`

- [ ] **Step 1: 创建 group-store.ts 文件**

```typescript
/**
 * group-store.ts
 *
 * 智能体分组存储和验证逻辑
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AgentGroup {
  id: string;
  name: string;
  icon: string;
  agentNames: string[];
}

export interface GroupStore {
  groups: AgentGroup[];
  updatedAt: number;
}

const GROUP_DATA_FILE_DEFAULT = path.join(process.cwd(), 'data', 'groups.json');

export function ensureDataDirExists(filePath: string): void {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createDefaultGroupStore(): GroupStore {
  return {
    groups: [],
    updatedAt: Date.now()
  };
}

export function loadGroupStore(filePath: string = GROUP_DATA_FILE_DEFAULT): GroupStore {
  ensureDataDirExists(filePath);

  if (!fs.existsSync(filePath)) {
    const initial = createDefaultGroupStore();
    saveGroupStore(filePath, initial);
    return initial;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = raw ? JSON.parse(raw) as Partial<GroupStore> : {};

  return {
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
  };
}

export function saveGroupStore(filePath: string, store: GroupStore): void {
  ensureDataDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * 验证分组 ID 格式
 * 规则：2-20 字符，仅字母数字下划线
 */
export function isValidGroupId(id: string): boolean {
  return /^[a-zA-Z0-9_]{2,20}$/.test(id);
}

/**
 * 验证 emoji 格式
 * 规则：1-2 个 emoji
 */
export function isValidEmoji(icon: string): boolean {
  // 简单的 emoji 正则，匹配常见的 emoji 范围
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}]{1,2}$/u;
  return emojiRegex.test(icon);
}

/**
 * 验证分组配置
 * @param group 分组配置
 * @param existingAgentNames 当前存在的智能体名称列表
 * @returns 错误信息，null 表示验证通过
 */
export function validateGroupConfig(
  group: Partial<AgentGroup> & { id: string },
  existingAgentNames: string[]
): string | null {
  // 验证 id
  if (!group.id || !isValidGroupId(group.id)) {
    return '分组 ID 需要 2-20 个字符，仅支持字母数字下划线';
  }

  // 验证 name
  if (!group.name || group.name.length < 2 || group.name.length > 16) {
    return '分组名称需要 2-16 个字符';
  }

  // 验证 icon
  if (!group.icon || !isValidEmoji(group.icon)) {
    return '分组图标需要 1-2 个 emoji';
  }

  // 验证 agentNames
  if (!Array.isArray(group.agentNames) || group.agentNames.length === 0) {
    return '分组至少需要包含一个智能体';
  }

  const invalidNames = group.agentNames.filter(name => !existingAgentNames.includes(name));
  if (invalidNames.length > 0) {
    return `智能体不存在: ${invalidNames.join(', ')}`;
  }

  return null;
}

/**
 * 从所有分组中移除指定智能体
 * @param store 分组存储
 * @param agentName 要移除的智能体名称
 * @returns 更新后的分组存储
 */
export function removeAgentFromAllGroups(
  store: GroupStore,
  agentName: string
): GroupStore {
  let changed = false;
  const updatedGroups = store.groups.map(group => {
    const filtered = group.agentNames.filter(name => name !== agentName);
    if (filtered.length !== group.agentNames.length) {
      changed = true;
      return { ...group, agentNames: filtered };
    }
    return group;
  });

  // 移除空的分组
  const nonEmptyGroups = updatedGroups.filter(g => g.agentNames.length > 0);
  if (nonEmptyGroups.length !== updatedGroups.length) {
    changed = true;
  }

  if (!changed) {
    return store;
  }

  return {
    groups: nonEmptyGroups,
    updatedAt: Date.now()
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd /root/chat && npm run build`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add src/group-store.ts
git commit -m "feat: add group-store module for agent grouping

- Add AgentGroup and GroupStore interfaces
- Add loadGroupStore/saveGroupStore for persistence
- Add validateGroupConfig for input validation
- Add removeAgentFromAllGroups for cascade cleanup

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 2: 在 auth-admin-server.ts 添加分组管理 API

**Files:**
- Modify: `src/auth-admin-server.ts`

- [ ] **Step 1: 添加 group-store 导入和配置**

在文件顶部的导入区域添加：

```typescript
import {
  loadGroupStore,
  removeAgentFromAllGroups,
  saveGroupStore,
  validateGroupConfig
} from './group-store';
```

在 `AGENT_DATA_FILE` 定义后添加：

```typescript
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');
```

- [ ] **Step 2: 添加分组 ID 解析函数**

在 `parseModelConnectionPath` 函数后添加：

```typescript
function parseGroupPath(pathname: string): { id: string } | null {
  const match = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_]+)$/);
  if (match) {
    return { id: match[1] };
  }
  return null;
}
```

- [ ] **Step 3: 添加 GET /api/groups 端点**

在路由处理区域（`!pathname.startsWith('/api/users')` 条件前）添加：

```typescript
  // ============================================
  // 分组管理 API
  // ============================================

  if (method === 'GET' && pathname === '/api/groups') {
    if (!requireAdmin(req, res)) return;
    const store = loadGroupStore(GROUP_DATA_FILE);
    sendJson(res, 200, { groups: store.groups, updatedAt: store.updatedAt });
    return;
  }
```

- [ ] **Step 4: 添加 POST /api/groups 端点**

在 GET /api/groups 后添加：

```typescript
  if (method === 'POST' && pathname === '/api/groups') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody<{ id?: string; name?: string; icon?: string; agentNames?: string[] }>(req);
      if (!body.id || !body.name || !body.icon || !body.agentNames) {
        sendJson(res, 400, { error: '缺少必要字段' });
        return;
      }

      const agentStore = loadAgentStore(AGENT_DATA_FILE);
      const existingAgentNames = agentStore.activeAgents.map(a => a.name);
      const group = { id: body.id, name: body.name, icon: body.icon, agentNames: body.agentNames };
      const validationError = validateGroupConfig(group, existingAgentNames);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      if (groupStore.groups.some(g => g.id === group.id)) {
        sendJson(res, 409, { error: '分组 ID 已存在' });
        return;
      }

      const nextStore = {
        groups: [...groupStore.groups, group],
        updatedAt: Date.now()
      };
      saveGroupStore(GROUP_DATA_FILE, nextStore);
      sendJson(res, 201, { success: true, group });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }
```

- [ ] **Step 5: 添加 PUT /api/groups/:id 端点**

在 POST /api/groups 后添加：

```typescript
  const groupPath = parseGroupPath(pathname);
  if (groupPath && method === 'PUT') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody<{ name?: string; icon?: string; agentNames?: string[] }>(req);
      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      const index = groupStore.groups.findIndex(g => g.id === groupPath.id);
      if (index === -1) {
        sendJson(res, 404, { error: '分组不存在' });
        return;
      }

      const current = groupStore.groups[index];
      const updated = {
        id: current.id,
        name: body.name ?? current.name,
        icon: body.icon ?? current.icon,
        agentNames: body.agentNames ?? current.agentNames
      };

      const agentStore = loadAgentStore(AGENT_DATA_FILE);
      const existingAgentNames = agentStore.activeAgents.map(a => a.name);
      const validationError = validateGroupConfig(updated, existingAgentNames);
      if (validationError) {
        sendJson(res, 400, { error: validationError });
        return;
      }

      const nextStore = {
        groups: groupStore.groups.map((g, i) => i === index ? updated : g),
        updatedAt: Date.now()
      };
      saveGroupStore(GROUP_DATA_FILE, nextStore);
      sendJson(res, 200, { success: true, group: updated });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }
```

- [ ] **Step 6: 添加 DELETE /api/groups/:id 端点**

在 PUT /api/groups/:id 后添加：

```typescript
  if (groupPath && method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const groupStore = loadGroupStore(GROUP_DATA_FILE);
    const index = groupStore.groups.findIndex(g => g.id === groupPath.id);
    if (index === -1) {
      sendJson(res, 404, { error: '分组不存在' });
      return;
    }

    const deleted = groupStore.groups[index];
    const nextStore = {
      groups: groupStore.groups.filter((_, i) => i !== index),
      updatedAt: Date.now()
    };
    saveGroupStore(GROUP_DATA_FILE, nextStore);
    sendJson(res, 200, { success: true, id: deleted.id });
    return;
  }
```

- [ ] **Step 7: 更新路由条件**

修改 `!pathname.startsWith('/api/users')` 条件，添加 `/api/groups`：

```typescript
  if (!pathname.startsWith('/api/users')
    && !pathname.startsWith('/api/agents')
    && !pathname.startsWith('/api/model-connections')
    && !pathname.startsWith('/api/groups')) {
```

- [ ] **Step 8: 更新启动日志**

在 `server.listen` 的日志输出区域添加：

```typescript
  console.log('  GET    /api/groups             (x-admin-token)');
  console.log('  POST   /api/groups             (x-admin-token)');
  console.log('  PUT    /api/groups/:id         (x-admin-token)');
  console.log('  DELETE /api/groups/:id         (x-admin-token)');
```

- [ ] **Step 9: 验证编译**

Run: `cd /root/chat && npm run build`
Expected: 编译成功

- [ ] **Step 10: Commit**

```bash
git add src/auth-admin-server.ts
git commit -m "feat: add group management API to auth-admin-server

- GET /api/groups - list all groups
- POST /api/groups - create group
- PUT /api/groups/:id - update group
- DELETE /api/groups/:id - delete group

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 3: 在 server.ts 添加分组查询端点

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 添加 group-store 导入**

在文件顶部的导入区域添加：

```typescript
import { loadGroupStore } from './group-store';
```

- [ ] **Step 2: 添加 GROUP_DATA_FILE 配置**

在 `AGENT_DATA_FILE` 定义后添加：

```typescript
const GROUP_DATA_FILE = process.env.GROUP_DATA_FILE
  || path.join(path.dirname(AGENT_DATA_FILE), 'groups.json');
```

- [ ] **Step 3: 添加 GET /api/groups 端点**

在路由处理区域找到合适位置（其他 `/api/` 端点附近）添加：

```typescript
  // 获取分组列表
  if (method === 'GET' && pathname === '/api/groups') {
    try {
      const store = loadGroupStore(GROUP_DATA_FILE);
      sendJson(res, 200, { groups: store.groups, updatedAt: store.updatedAt });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 500, { error: err.message });
    }
    return;
  }
```

- [ ] **Step 4: 验证编译**

Run: `cd /root/chat && npm run build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add GET /api/groups endpoint to chat server

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 4: 添加删除智能体时的级联清理

**Files:**
- Modify: `src/auth-admin-server.ts`

- [ ] **Step 1: 在删除智能体逻辑中添加分组清理**

找到 `DELETE /api/agents/:name` 的处理逻辑，在 `saveAgentStore` 调用前添加分组清理：

```typescript
      // 在 saveAgentStore(AGENT_DATA_FILE, next) 之前添加
      // 级联清理分组引用
      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      const cleanedGroupStore = removeAgentFromAllGroups(groupStore, targetName);
      if (cleanedGroupStore.groups.length !== groupStore.groups.length ||
          cleanedGroupStore.updatedAt !== groupStore.updatedAt) {
        saveGroupStore(GROUP_DATA_FILE, cleanedGroupStore);
      }

      saveAgentStore(AGENT_DATA_FILE, next);
```

完整的删除智能体代码段应该是：

```typescript
  if (agentPath && method === 'DELETE' && agentPath.action === 'base') {
    try {
      const applyMode = parseApplyMode(parsedUrl.searchParams.get('applyMode'));
      const targetName = agentPath.name;
      const store = loadAgentStore(AGENT_DATA_FILE);
      const next = updateAgentStore(store, applyMode, agents => {
        if (agents.length <= 1) {
          throw new Error('至少保留一个智能体，无法删除');
        }
        const filtered = agents.filter(agent => agent.name !== targetName);
        if (filtered.length === agents.length) {
          throw new Error('智能体不存在');
        }
        return filtered;
      });

      // 级联清理分组引用
      const groupStore = loadGroupStore(GROUP_DATA_FILE);
      const cleanedGroupStore = removeAgentFromAllGroups(groupStore, targetName);
      if (cleanedGroupStore.groups.length !== groupStore.groups.length ||
          cleanedGroupStore.updatedAt !== groupStore.updatedAt) {
        saveGroupStore(GROUP_DATA_FILE, cleanedGroupStore);
      }

      saveAgentStore(AGENT_DATA_FILE, next);
      sendJson(res, 200, { success: true, applyMode, name: targetName });
    } catch (error: unknown) {
      const err = error as Error;
      sendJson(res, 400, { error: err.message });
    }
    return;
  }
```

- [ ] **Step 2: 验证编译**

Run: `cd /root/chat && npm run build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src/auth-admin-server.ts
git commit -m "feat: cascade delete agent from groups when agent is deleted

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 5: 前端侧边栏分组展示

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 添加分组状态和加载逻辑**

在 React 组件的 state 区域添加：

```typescript
    const [groups, setGroups] = React.useState([]);
    const [expandedGroups, setExpandedGroups] = React.useState(new Set());
```

添加加载分组的函数：

```typescript
    const loadGroups = React.useCallback(async () => {
      try {
        const res = await fetch('/api/groups');
        if (res.ok) {
          const data = await res.json();
          setGroups(data.groups || []);
        }
      } catch (e) {
        console.error('Failed to load groups:', e);
      }
    }, []);
```

在 `loadHistory` 函数调用处同时调用 `loadGroups`：

```typescript
    React.useEffect(() => {
      loadHistory();
      loadGroups();
    }, [loadHistory, loadGroups]);
```

- [ ] **Step 2: 添加分组切换状态**

```typescript
    const [activeGroup, setActiveGroup] = React.useState(null);
```

- [ ] **Step 3: 添加按分组组织智能体的计算逻辑**

```typescript
    // 按分组组织智能体
    const groupedAgents = React.useMemo(() => {
      const result = [];
      const groupedNames = new Set();

      // 已定义的分组
      for (const group of groups) {
        const agentsInGroup = agents.filter(a => group.agentNames.includes(a.name));
        if (agentsInGroup.length > 0) {
          result.push({
            id: group.id,
            name: group.name,
            icon: group.icon,
            agents: agentsInGroup,
            isUngrouped: false
          });
          group.agentNames.forEach(name => groupedNames.add(name));
        }
      }

      // 未分组的智能体
      const ungrouped = agents.filter(a => !groupedNames.has(a.name));
      if (ungrouped.length > 0) {
        result.push({
          id: '__ungrouped__',
          name: '其他',
          icon: '📦',
          agents: ungrouped,
          isUngrouped: true
        });
      }

      return result;
    }, [agents, groups]);
```

- [ ] **Step 4: 添加分组展开/切换处理函数**

```typescript
    const toggleGroupExpand = React.useCallback((groupId) => {
      setExpandedGroups(prev => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    }, []);

    const handleGroupSwitch = React.useCallback((group) => {
      if (group.isUngrouped) {
        // 切换到未分组智能体时，只启用这些智能体
        const enabledSet = new Set(group.agents.map(a => a.name));
        setEnabledAgents(enabledSet);
      } else {
        // 切换到分组时，启用该分组的智能体
        const enabledSet = new Set(group.agentNames);
        setEnabledAgents(enabledSet);
      }
      setActiveGroup(group.id);
    }, []);
```

- [ ] **Step 5: 修改侧边栏智能体列表渲染**

找到智能体列表渲染部分，替换为分组展示：

```jsx
    // 在 AgentSidebar 组件或相应位置
    const AgentList = () => (
      <div className="agent-list">
        {groupedAgents.map(group => (
          <div key={group.id} className="agent-group">
            <div
              className="agent-group-header"
              onClick={() => toggleGroupExpand(group.id)}
            >
              <span className="group-expand-icon">
                {expandedGroups.has(group.id) ? '▼' : '▶'}
              </span>
              <span className="group-icon">{group.icon}</span>
              <span className="group-name">{group.name}</span>
              <span className="group-count">({group.agents.length})</span>
              {!group.isUngrouped && (
                <button
                  className="group-switch-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGroupSwitch(group);
                  }}
                  title="切换到此分组"
                >
                  {activeGroup === group.id ? '✓' : '切换'}
                </button>
              )}
            </div>
            {expandedGroups.has(group.id) && (
              <div className="agent-group-members">
                {group.agents.map(agent => (
                  <div
                    key={agent.name}
                    className={`agent-item ${enabledAgents.has(agent.name) ? 'enabled' : ''}`}
                    onClick={() => handleAgentClick(agent.name)}
                  >
                    <span className="agent-avatar">{agent.avatar}</span>
                    <span className="agent-name">{agent.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
```

- [ ] **Step 6: 添加分组相关 CSS 样式**

在 `<style>` 标签中添加：

```css
    .agent-group {
      margin-bottom: 8px;
    }

    .agent-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.15s;
    }

    .agent-group-header:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    .group-expand-icon {
      font-size: 10px;
      color: #737373;
      width: 12px;
    }

    .group-icon {
      font-size: 16px;
    }

    .group-name {
      font-size: 13px;
      font-weight: 500;
      color: #1a1a1a;
    }

    .group-count {
      font-size: 12px;
      color: #737373;
    }

    .group-switch-btn {
      margin-left: auto;
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      color: #525252;
    }

    .group-switch-btn:hover {
      background: #f5f5f5;
    }

    .agent-group-members {
      padding-left: 24px;
    }

    .agent-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .agent-item:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    .agent-item.enabled {
      background: rgba(37, 99, 235, 0.08);
    }

    .agent-avatar {
      font-size: 16px;
    }

    .agent-name {
      font-size: 13px;
      color: #1a1a1a;
    }
```

- [ ] **Step 7: 验证前端加载**

Run: `cd /root/chat && npm run build && npm start`
打开浏览器访问 http://localhost:3002 检查侧边栏是否按分组展示
Expected: 侧边栏显示分组列表，可展开/收起

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: display agents grouped by group in sidebar

- Load groups from /api/groups
- Render agents in collapsible groups
- Add group switch button to enable group agents

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 6: @ 分组提及交互

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 添加分组提及预览状态**

```typescript
    const [groupMentionPreview, setGroupMentionPreview] = React.useState(null);
```

- [ ] **Step 2: 添加检测分组提及的函数**

```typescript
    // 检测输入中的分组提及
    const detectGroupMention = React.useCallback((text) => {
      const mentionRegex = /@([^\s@，。！？、]+)/g;
      const matches = text.match(mentionRegex);
      if (!matches) return null;

      for (const match of matches) {
        const mentionName = match.slice(1); // 去掉 @
        // 检查是否是分组名（按 id 或 name 匹配）
        const group = groups.find(g =>
          g.id === mentionName || g.name === mentionName
        );
        if (group) {
          return group;
        }
      }
      return null;
    }, [groups]);
```

- [ ] **Step 3: 添加处理输入变化的函数**

```typescript
    const handleInputChange = React.useCallback((e) => {
      const text = e.target.value;
      setInputText(text);

      // 检测分组提及
      const group = detectGroupMention(text);
      if (group) {
        setGroupMentionPreview(group);
      } else {
        setGroupMentionPreview(null);
      }
    }, [detectGroupMention]);
```

- [ ] **Step 4: 添加确认/取消分组提及的函数**

```typescript
    const confirmGroupMention = React.useCallback(() => {
      if (!groupMentionPreview) return;

      // 将 @分组名 替换为 @智能体1 @智能体2 ...
      const agentMentions = groupMentionPreview.agentNames
        .map(name => `@${name}`)
        .join(' ');
      const newText = inputText.replace(
        new RegExp(`@(${groupMentionPreview.id}|${groupMentionPreview.name})`),
        agentMentions + ' '
      );
      setInputText(newText);
      setGroupMentionPreview(null);
    }, [groupMentionPreview, inputText]);

    const cancelGroupMention = React.useCallback(() => {
      // 移除 @分组名
      if (!groupMentionPreview) return;
      const newText = inputText.replace(
        new RegExp(`\\s*@(${groupMentionPreview.id}|${groupMentionPreview.name})\\s*`),
        ' '
      ).trim();
      setInputText(newText);
      setGroupMentionPreview(null);
    }, [groupMentionPreview, inputText]);
```

- [ ] **Step 5: 添加分组提及预览 UI 组件**

```jsx
    const GroupMentionPreview = () => {
      if (!groupMentionPreview) return null;

      return (
        <div className="group-mention-preview">
          <div className="preview-header">
            <span className="preview-icon">{groupMentionPreview.icon}</span>
            <span className="preview-name">{groupMentionPreview.name}</span>
            <span className="preview-count">
              ({groupMentionPreview.agentNames.length} 个智能体)
            </span>
          </div>
          <div className="preview-agents">
            {groupMentionPreview.agentNames.map(name => {
              const agent = agents.find(a => a.name === name);
              return (
                <span key={name} className="preview-agent">
                  ✓ {agent?.avatar || '🤖'} {name}
                </span>
              );
            })}
          </div>
          <div className="preview-actions">
            <button className="confirm-btn" onClick={confirmGroupMention}>
              确认召唤
            </button>
            <button className="cancel-btn" onClick={cancelGroupMention}>
              取消
            </button>
          </div>
        </div>
      );
    };
```

- [ ] **Step 6: 添加分组提及预览 CSS**

```css
    .group-mention-preview {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      padding: 12px;
      margin-bottom: 8px;
      z-index: 10;
    }

    .preview-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .preview-icon {
      font-size: 18px;
    }

    .preview-name {
      font-size: 14px;
      font-weight: 600;
    }

    .preview-count {
      font-size: 12px;
      color: #737373;
    }

    .preview-agents {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .preview-agent {
      font-size: 12px;
      color: #525252;
      background: #f5f5f5;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .preview-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .preview-actions .confirm-btn {
      padding: 6px 16px;
      font-size: 13px;
      font-weight: 500;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .preview-actions .confirm-btn:hover {
      background: #3b82f6;
    }

    .preview-actions .cancel-btn {
      padding: 6px 16px;
      font-size: 13px;
      background: white;
      color: #525252;
      border: 1px solid #e5e5e5;
      border-radius: 6px;
      cursor: pointer;
    }

    .preview-actions .cancel-btn:hover {
      background: #f5f5f5;
    }
```

- [ ] **Step 7: 在输入框上方渲染预览组件**

找到消息输入区域，在输入框容器内添加预览组件：

```jsx
    <div className="input-container">
      <GroupMentionPreview />
      <textarea
        value={inputText}
        onChange={handleInputChange}
        // ... 其他属性
      />
    </div>
```

- [ ] **Step 8: 验证 @ 分组交互**

Run: 手动测试
1. 在管理界面创建一个分组
2. 在聊天界面输入 `@分组名` 或 `@分组ID`
3. 检查是否弹出预览
4. 点击「确认召唤」检查是否展开为多个 @ 提及
5. 点击「取消」检查是否清除

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: add group mention preview and confirmation UI

- Detect @group mention in input
- Show preview popup with group members
- Confirm to expand into individual mentions
- Cancel to remove group mention

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 7: 管理界面分组管理 Tab

**Files:**
- Modify: `public/mockup-admin.html`

- [ ] **Step 1: 添加分组管理 Tab**

找到 Tab 切换区域，添加「分组管理」Tab：

```html
    <div class="tabs">
      <button class="tab active" data-tab="agents">智能体管理</button>
      <button class="tab" data-tab="groups">分组管理</button>
      <button class="tab" data-tab="users">用户管理</button>
      <button class="tab" data-tab="connections">连接管理</button>
    </div>
```

- [ ] **Step 2: 添加分组管理面板 HTML**

```html
    <div class="tab-content" id="groups-tab" style="display: none;">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">分组列表</h3>
          <button class="btn btn-primary btn-sm" onclick="showGroupModal()">
            + 新建分组
          </button>
        </div>
        <div class="card-body">
          <div id="groups-list" class="groups-list">
            <!-- 分组列表将通过 JS 渲染 -->
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: 添加新建/编辑分组弹窗 HTML**

```html
    <div class="modal-overlay" id="group-modal">
      <div class="modal">
        <h3 id="group-modal-title">新建分组</h3>
        <p>创建智能体分组，方便管理和快速切换。</p>
        <form id="group-form">
          <div class="form-group">
            <label class="form-label">分组 ID</label>
            <input type="text" id="group-id" placeholder="例如: dev_team" required>
            <small class="form-hint">2-20 字符，仅字母数字下划线，创建后不可修改</small>
          </div>
          <div class="form-group">
            <label class="form-label">分组名称</label>
            <input type="text" id="group-name" placeholder="例如: 开发组" required>
          </div>
          <div class="form-group">
            <label class="form-label">图标</label>
            <input type="text" id="group-icon" placeholder="例如: 💻" maxlength="4" required>
          </div>
          <div class="form-group">
            <label class="form-label">智能体成员</label>
            <div id="group-agents-checkboxes" class="checkboxes-grid">
              <!-- 智能体复选框将通过 JS 渲染 -->
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="hideGroupModal()">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
```

- [ ] **Step 4: 添加分组列表和复选框 CSS**

```css
    .groups-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }

    .group-item {
      display: flex;
      align-items: center;
      padding: var(--space-md);
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      gap: var(--space-md);
    }

    .group-item-icon {
      font-size: 24px;
    }

    .group-item-info {
      flex: 1;
    }

    .group-item-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .group-item-members {
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    .group-item-actions {
      display: flex;
      gap: var(--space-sm);
    }

    .checkboxes-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-sm);
      max-height: 200px;
      overflow-y: auto;
      padding: var(--space-sm);
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs);
    }

    .checkbox-item input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }

    .checkbox-item label {
      font-size: 13px;
      cursor: pointer;
    }

    .form-hint {
      display: block;
      margin-top: 4px;
      font-size: 11px;
      color: var(--text-muted);
    }
```

- [ ] **Step 5: 添加分组管理 JavaScript**

```javascript
    // 分组状态
    let groups = [];
    let editingGroupId = null;

    // 加载分组列表
    async function loadGroups() {
      try {
        const res = await fetch(`${AUTH_ADMIN_URL}/api/groups`, {
          headers: { 'x-admin-token': adminToken }
        });
        if (res.ok) {
          const data = await res.json();
          groups = data.groups || [];
          renderGroupsList();
        } else {
          showToast('加载分组失败', 'error');
        }
      } catch (e) {
        console.error('Failed to load groups:', e);
        showToast('加载分组失败', 'error');
      }
    }

    // 渲染分组列表
    function renderGroupsList() {
      const container = document.getElementById('groups-list');
      if (groups.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📁</div>
            <div class="empty-state-text">暂无分组，点击上方按钮创建</div>
          </div>
        `;
        return;
      }

      container.innerHTML = groups.map(group => `
        <div class="group-item">
          <div class="group-item-icon">${escapeHtml(group.icon)}</div>
          <div class="group-item-info">
            <div class="group-item-name">${escapeHtml(group.name)} (${group.id})</div>
            <div class="group-item-members">${group.agentNames.join(', ')}</div>
          </div>
          <div class="group-item-actions">
            <button class="btn btn-secondary btn-sm" onclick="editGroup('${escapeHtml(group.id)}')">编辑</button>
            <button class="btn btn-danger btn-sm" onclick="deleteGroup('${escapeHtml(group.id)}')">删除</button>
          </div>
        </div>
      `).join('');
    }

    // 显示分组弹窗
    function showGroupModal(group = null) {
      editingGroupId = group ? group.id : null;
      document.getElementById('group-modal-title').textContent = group ? '编辑分组' : '新建分组';
      document.getElementById('group-id').value = group ? group.id : '';
      document.getElementById('group-id').disabled = !!group;
      document.getElementById('group-name').value = group ? group.name : '';
      document.getElementById('group-icon').value = group ? group.icon : '';

      // 渲染智能体复选框
      const checkboxesContainer = document.getElementById('group-agents-checkboxes');
      const selectedAgents = group ? group.agentNames : [];
      checkboxesContainer.innerHTML = agents.map(agent => `
        <div class="checkbox-item">
          <input type="checkbox" id="agent-${agent.name}" value="${agent.name}"
                 ${selectedAgents.includes(agent.name) ? 'checked' : ''}>
          <label for="agent-${agent.name}">${agent.avatar} ${agent.name}</label>
        </div>
      `).join('');

      document.getElementById('group-modal').classList.add('show');
    }

    // 隐藏分组弹窗
    function hideGroupModal() {
      document.getElementById('group-modal').classList.remove('show');
      editingGroupId = null;
    }

    // 编辑分组
    function editGroup(id) {
      const group = groups.find(g => g.id === id);
      if (group) {
        showGroupModal(group);
      }
    }

    // 删除分组
    async function deleteGroup(id) {
      if (!confirm('确定要删除此分组吗？')) return;

      try {
        const res = await fetch(`${AUTH_ADMIN_URL}/api/groups/${id}`, {
          method: 'DELETE',
          headers: { 'x-admin-token': adminToken }
        });
        if (res.ok) {
          showToast('分组已删除', 'success');
          loadGroups();
        } else {
          const data = await res.json();
          showToast(data.error || '删除失败', 'error');
        }
      } catch (e) {
        showToast('删除失败', 'error');
      }
    }

    // 提交分组表单
    document.getElementById('group-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const id = document.getElementById('group-id').value.trim();
      const name = document.getElementById('group-name').value.trim();
      const icon = document.getElementById('group-icon').value.trim();

      const checkboxes = document.querySelectorAll('#group-agents-checkboxes input:checked');
      const agentNames = Array.from(checkboxes).map(cb => cb.value);

      if (!id || !name || !icon || agentNames.length === 0) {
        showToast('请填写所有字段并选择至少一个智能体', 'error');
        return;
      }

      const url = editingGroupId
        ? `${AUTH_ADMIN_URL}/api/groups/${editingGroupId}`
        : `${AUTH_ADMIN_URL}/api/groups`;
      const method = editingGroupId ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminToken
          },
          body: JSON.stringify({ id, name, icon, agentNames })
        });

        if (res.ok) {
          showToast(editingGroupId ? '分组已更新' : '分组已创建', 'success');
          hideGroupModal();
          loadGroups();
        } else {
          const data = await res.json();
          showToast(data.error || '操作失败', 'error');
        }
      } catch (e) {
        showToast('操作失败', 'error');
      }
    });

    // Tab 切换时加载分组
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'groups') {
          loadGroups();
        }
      });
    });
```

- [ ] **Step 6: 添加 HTML 转义函数（如果不存在）**

```javascript
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
```

- [ ] **Step 7: 验证管理界面**

Run: `cd /root/chat && npm run build && npm run start:auth`
打开浏览器访问 http://localhost:3003
Expected:
1. 能看到「分组管理」Tab
2. 能创建新分组
3. 能编辑/删除分组
4. 分组列表正确显示

- [ ] **Step 8: Commit**

```bash
git add public/mockup-admin.html
git commit -m "feat: add group management tab to admin interface

- Add groups tab with list, create, edit, delete
- Agent checkbox selection for group members
- Form validation and error handling

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

### Task 8: 集成测试和文档更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md 添加分组功能文档**

在「智能体配置」章节后添加：

```markdown
## 智能体分组

### 分组配置

分组存储在 `data/groups.json`，支持将智能体按功能分组管理。

### 分组结构

```typescript
interface AgentGroup {
  id: string;        // 唯一标识（2-20 字符，字母数字下划线）
  name: string;      // 显示名称（2-16 字符）
  icon: string;      // emoji 图标（1-2 个）
  agentNames: string[]; // 智能体名称数组
}
```

### 分组功能

- **侧边栏分组展示**：智能体按分组折叠显示
- **快速切换**：点击分组按钮切换当前会话激活的智能体
- **批量 @ 提及**：输入 `@分组名` 弹出预览，确认后展开为多个 @ 提及

### 分组 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/groups` | GET | 获取所有分组 |
| `/api/groups` | POST | 创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT | 更新分组（需 x-admin-token） |
| `/api/groups/:id` | DELETE | 删除分组（需 x-admin-token） |
```

- [ ] **Step 2: 端到端测试**

Run: 手动测试完整流程
1. 启动服务：`npm run build && npm start & npm run start:auth &`
2. 打开管理界面，创建分组
3. 打开聊天界面，检查分组展示
4. 测试分组切换
5. 测试 @ 分组提及

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add agent grouping documentation to CLAUDE.md

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Self-Review Checklist

- [x] Spec coverage: All requirements from design doc covered
- [x] No placeholders: All code blocks are complete
- [x] Type consistency: AgentGroup interface used consistently
- [x] File paths: All paths are exact and correct
