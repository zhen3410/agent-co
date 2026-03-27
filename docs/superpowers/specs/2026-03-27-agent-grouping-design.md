# 智能体分组功能设计

## 概述

为多 AI 智能体聊天室添加分组功能，支持用户自定义分组管理智能体，实现组织管理、场景切换和批量 @ 提及。

## 需求总结

| 维度 | 决定 |
|------|------|
| 使用场景 | 组织管理 + 场景切换 + 批量 @ 提及 |
| 作用范围 | 全局共享，管理员配置 |
| 关系模型 | 多对多（智能体可属于多个分组） |
| UI 展示 | 侧边栏分类展示 + 分组切换面板 |
| @ 提及行为 | 展开预览后确认 |
| 存储位置 | 新建 `data/groups.json` |

## 数据结构

### 新建文件 `data/groups.json`

```json
{
  "groups": [
    {
      "id": "dev",
      "name": "编程组",
      "icon": "💻",
      "agentNames": ["Claude", "Codex架构师", "Bob"]
    },
    {
      "id": "design",
      "name": "设计组",
      "icon": "🎨",
      "agentNames": ["Alice"]
    }
  ],
  "updatedAt": 1709300000000
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，用于 @ 提及匹配 |
| `name` | string | 显示名称 |
| `icon` | string | emoji 图标 |
| `agentNames` | string[] | 智能体名称数组（引用） |

### 验证规则

- `id`: 2-20 字符，仅字母数字下划线
- `name`: 2-16 字符
- `icon`: 1-2 个 emoji
- `agentNames`: 至少 1 个，所有名称必须存在于当前智能体列表

## 后端 API

### 鉴权管理服务 (`auth-admin-server.ts`)

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/groups` | GET | 获取所有分组 |
| `/api/groups` | POST | 创建分组（需 x-admin-token） |
| `/api/groups/:id` | PUT | 更新分组（需 x-admin-token） |
| `/api/groups/:id` | DELETE | 删除分组（需 x-admin-token） |

### 请求/响应示例

```typescript
// POST /api/groups
// 请求
{ "id": "dev", "name": "编程组", "icon": "💻", "agentNames": ["Claude"] }
// 响应
{ "success": true, "group": { "id": "dev", "name": "编程组", "icon": "💻", "agentNames": ["Claude"] } }

// PUT /api/groups/:id
// 请求
{ "name": "开发组", "icon": "🛠️", "agentNames": ["Claude", "Bob"] }
// 响应
{ "success": true, "group": { ... } }

// DELETE /api/groups/:id
// 响应
{ "success": true }
```

### 聊天服务 (`server.ts`)

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/groups` | GET | 获取所有分组（前端查询用） |

## 后端服务层

### 新建文件 `src/group-store.ts`

```typescript
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

// 核心函数
export function loadGroupStore(filePath: string): GroupStore;
export function saveGroupStore(filePath: string, store: GroupStore): void;
export function validateGroupConfig(group: AgentGroup, existingAgentNames: string[]): string | null;
export function createDefaultGroupStore(): GroupStore;
```

### 验证逻辑

`validateGroupConfig(group, existingAgentNames)`:
- `id` 格式检查（2-20 字符，字母数字下划线）
- `name` 长度检查（2-16 字符）
- `icon` emoji 检查
- `agentNames` 非空 + 所有名称必须在 `existingAgentNames` 中

### 级联处理

删除智能体时，自动从所有分组的 `agentNames` 中移除该名称。

## 前端 UI

### 侧边栏分组展示

智能体列表按分组折叠/展开显示：

```
▼ 💻 编程组 (3)
    🤖 Claude
    🏗️ Codex架构师
    🧑‍💻 Bob
▶ 🎨 设计组 (1)
▼ 📦 其他 (1)
    👩‍💻 Alice
```

- 未分组智能体显示在「其他」分组下
- 每个分组可点击展开/收起

### 分组切换面板

- 在智能体列表上方增加「快速切换」按钮
- 点击分组名 → 当前会话的 `enabledAgents` 设为该组智能体
- 视觉反馈：当前激活的分组高亮

### @ 提及分组交互

1. 用户输入 `@编程组`
2. 系统检测到分组名，弹出浮层预览：
   ```
   编程组 (3 个智能体)
   ✓ Claude  ✓ Codex架构师  ✓ Bob
   [确认召唤] [取消]
   ```
3. 用户点击「确认召唤」→ 消息变为 `@Claude @Codex架构师 @Bob ...`
4. 用户点击「取消」→ 清除 @ 提及

## 管理界面

扩展现有 `public/mockup-admin.html`，新增「分组管理」Tab。

### 分组列表

```
┌─────────────────────────────────────────────────┐
│ 分组列表                                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ 💻 编程组                    [编辑] [删除]   │ │
│ │    Claude, Codex架构师, Bob                  │ │
│ ├─────────────────────────────────────────────┤ │
│ │ 🎨 设计组                    [编辑] [删除]   │ │
│ │    Alice                                     │ │
│ └─────────────────────────────────────────────┘ │
│ [+ 新建分组]                                     │
└─────────────────────────────────────────────────┘
```

### 新建/编辑分组弹窗

- 分组 ID（新建时必填，创建后不可修改）
- 分组名称
- 图标（emoji 选择器或手动输入）
- 智能体多选（checkbox 列表）

## 实现范围

### 新增文件

- `src/group-store.ts` - 分组存储和验证逻辑
- `data/groups.json` - 分组数据文件（首次运行自动创建）

### 修改文件

- `src/auth-admin-server.ts` - 新增分组管理 API
- `src/server.ts` - 新增 `/api/groups` GET 端点
- `src/agent-config-store.ts` - 删除智能体时级联清理分组引用
- `public/index.html` - 侧边栏分组展示、分组切换、@ 提及分组交互
- `public/mockup-admin.html` - 分组管理 Tab
