# Chat 模块化重构阶段 1-4 架构说明

> 更新时间：2026-04-08  
> 分支：`refactor-modular-refactor`

## 1. 文档目标

本文汇总阶段 1 到阶段 4 的架构演进，说明本轮 maintainability modular refactor 做了什么、每个阶段收敛了哪些边界、当前代码应如何理解，以及后续演进应该沿着什么方向继续推进。

本文关注的是**架构与模块边界**，不是功能说明。

---

## 2. 总体演进脉络

这 4 个阶段的主线是一致的：

1. 先锁定外部行为契约，防止重构把现有 API 行为改坏。
2. 再把单体入口和超大模块拆成组合根 + 明确职责模块。
3. 把“编排逻辑”和“纯规则”进一步分离。
4. 把运行时组合、provider 选择、HTTP adapter 等高耦合点改造成显式 seam。

整体上，代码从“入口文件和大服务文件承载大量职责”的状态，演进为：

```text
HTTP Adapter
  -> Application Services
    -> Domain Policies
      -> Runtime Facade
        -> Infrastructure Stores / Providers
```

当前的核心设计原则：

- `server.ts` / `auth-admin-server.ts` 只做组合根与启动入口
- route 只处理 HTTP 协议和请求/响应映射
- application service 只做用例编排
- domain policy 只放纯规则
- runtime 负责运行态状态与组合
- infrastructure 负责 Redis、文件、仓储、provider 等具体实现

---

## 3. 阶段 1：建立模块化骨架

### 3.1 目标

阶段 1 的目标是把“单体入口 + 隐式耦合”的服务拆成可维护的基本模块结构，同时保持部署形式和对外 API 不变。

对应计划文档：
- `docs/superpowers/plans/2026-03-19-maintainability-modular-refactor.md`

关键提交：
- `21401cc` `test: lock server contracts before modular refactor`
- `5db23a5` `refactor: extract shared http helpers`
- `f0c2806` `refactor: split chat bootstrap wiring`

### 3.2 核心变化

#### A. 先锁住契约

在正式拆模块前，先补了回归测试，覆盖：

- session CRUD
- history / activeSession 切换
- callback 行为
- ops / verbose / dependency 等边界接口

这一步把“现有行为”转成了自动化 contract gate，后面每次结构调整都可以通过测试兜底。

#### B. 提取 shared HTTP helpers

把原来入口文件里重复的 HTTP 通用逻辑拆出来，形成：

- `src/shared/http/body.ts`
- `src/shared/http/json.ts`
- `src/shared/http/cors.ts`
- `src/shared/http/static-files.ts`
- `src/shared/http/errors.ts`

这一步的意义不是“工具化”本身，而是把**协议层通用逻辑**从业务层中剥离出来。

#### C. 入口开始转成组合根

阶段 1 之后，`src/server.ts` 不再是业务大杂烩，而开始朝组合根演进：

- 负责读取配置
- 装配 runtime / service / route
- 注册启动与关闭逻辑
- 不再直接承载所有具体业务

### 3.3 阶段 1 的架构价值

阶段 1 建立的是整个重构的基础盘：

- 先有 contract，才敢大胆重构
- 先提 shared seam，后续 route 和 server 才能继续变薄
- 先把入口从“实现文件”变成“组合根”，后面阶段才能持续拆分

一句话概括：

> 阶段 1 不是把系统拆完，而是让系统进入“可以持续拆”的状态。

---

## 4. 阶段 2：拆 runtime / chat-service / session-service / ops-routes

### 4.1 目标

阶段 2 的目标是把第一轮模块化后的大块职责继续拆细，重点处理：

- `chat-runtime.ts`
- `chat-service.ts`
- `session-service.ts`
- `ops-routes.ts`

对应计划文档：
- `docs/superpowers/plans/2026-04-07-chat-modularization-phase-2.md`

### 4.2 核心变化

#### A. Runtime 被拆成多个子模块

原先 `chat-runtime.ts` 同时承载：

- session state
- discussion state
- Redis 持久化
- dependency status / ops log

阶段 2 将其拆成：

- `chat-runtime-types.ts`
- `chat-session-state.ts`
- `chat-discussion-state.ts`
- `chat-runtime-persistence.ts`
- `chat-runtime-dependencies.ts`

`chat-runtime.ts` 则收缩为 façade / composition 层。

#### B. chat-service 被拆成多个编排模块

把原先混在 `chat-service.ts` 中的大量执行逻辑拆分为：

- `chat-agent-execution.ts`
- `chat-dispatch-orchestrator.ts`
- `chat-summary-service.ts`
- `chat-resume-service.ts`
- `chat-service-types.ts`

这一步的重点是：

- 单 agent 执行逻辑从总编排中分离
- 链式调度与继续传播逻辑集中
- summary / resume 成为独立用例模块

#### C. session-service 按职责切片

把 session 相关逻辑按用途拆开：

- `session-query-service.ts`
- `session-command-service.ts`
- `session-agent-service.ts`
- `session-discussion-service.ts`
- `session-service-types.ts`

这样 session-service 不再是“所有 session 相关逻辑的总桶”。

#### D. ops-routes 拆成 route groups

把运维类 HTTP 路由拆成：

- `ops/dependency-routes.ts`
- `ops/system-routes.ts`
- `ops/verbose-log-routes.ts`

使 `ops-routes.ts` 本身变成 dispatcher。

### 4.3 阶段 2 的架构价值

阶段 2 的本质是把“已有模块”进一步去中心化。

它带来的改变是：

- runtime 不再是一个大状态容器文件
- chat-service 不再同时处理所有执行路径
- session-service 不再把查询、命令、agent 设置、discussion 逻辑全部揉在一起
- ops 路由不再是另一个大分发文件

一句话概括：

> 阶段 2 把阶段 1 的“模块化骨架”进一步演进为“明确职责的模块簇”。

---

## 5. 阶段 3：强化边界语义与低层测试能力

### 5.1 目标

阶段 3 的目标，是让系统不仅“拆开了”，而且“边界更清晰、更可靠”。

重点是：

- 错误语义统一
- agent invocation 成为独立子系统
- 增加更快的 unit / fast 测试层

对应计划文档：
- `docs/superpowers/plans/2026-04-07-chat-modularization-phase-3.md`

关键提交：
- `a781743` `refactor: add typed app error mapping`
- `ed2880a` `refactor: extract agent invocation subsystem`
- `de72e76` `test: add fast contract and unit coverage`
- `d03fb24` `docs: record phase 3 modularization plan`

### 5.2 核心变化

#### A. 引入 typed app error mapping

以前很多错误路径是：

- route / service 各自拼接错误
- HTTP status 与业务语义的对应关系分散
- validation / auth / not-found / conflict 的表达不统一

阶段 3 增加了 typed error 体系，使得：

- 错误可以带明确 code / status 语义
- HTTP mapping 可以集中处理
- 内部错误表达与外部响应契约分离

这使 route 更像 adapter，而不是错误分发中心。

#### B. 把 agent invocation 拆成独立子系统

新增子系统：

- `agent-invocation/agent-invoker-types.ts`
- `agent-invocation/invoke-target.ts`
- `agent-invocation/model-connection-loader.ts`
- `agent-invocation/invoke-cli-agent.ts`
- `agent-invocation/invoke-api-agent.ts`
- `agent-invocation/agent-invoker.ts`

并让根部的 `src/agent-invoker.ts` 变成兼容 façade。

这一步的架构意义很大：

- provider-specific orchestration 不再散在外层业务中
- execution target normalization 与 model connection loading 各自独立
- invocation 相关逻辑形成可单测的低层模块

#### C. 增加低层测试层

阶段 3 把测试层从“主要依赖 integration suite”升级为：

- integration tests：最终回归 safety net
- unit tests：纯规则 / 低层模块快速验证
- fast tests：稳定边界契约的快速检查

这使未来做结构性重构时，不必每次都完全依赖耗时更长的大集成测试来发现低级边界回退。

### 5.3 阶段 3 的架构价值

阶段 3 让系统从“拆得开”走向“边界有语义、有验证层次”。

一句话概括：

> 阶段 3 把模块化从目录结构层面，推进到了错误模型、调用边界和测试层次结构层面。

---

## 6. 阶段 4：收敛高耦合 seam

### 6.1 目标

阶段 4 继续沿着 `http -> application -> runtime/infrastructure` 分层方向推进，重点处理仍然偏重的几个高价值 seam：

1. route helper seam
2. discussion / chain policy seam
3. provider registry seam
4. runtime store seam

对应计划文档：
- `docs/superpowers/plans/2026-04-07-chat-modularization-phase-4.md`

关键提交：
- `be7c97d` `refactor: slim chat http route adapters`
- `20fcc17` `refactor: extract chat discussion and chain policies`
- `7d87dbe` `refactor: add invocation provider registry`
- `383d337` `refactor: clarify runtime store composition`

### 6.2 核心变化

#### A. route helper seam

新增：

- `src/chat/http/auth-route-helpers.ts`
- `src/chat/http/callback-route-helpers.ts`
- `src/chat/http/chat-route-helpers.ts`

结果：

- `auth-routes.ts`
- `callback-routes.ts`
- `chat-routes.ts`

进一步变薄，主要承担：

- path / method 匹配
- 请求上下文组装
- 调用 service
- 写回响应

而 cookie/header/body normalize、callback token 解析、chat body 规范化等逻辑则被明确地下沉到 helper。

#### B. discussion / chain policy seam

新增：

- `src/chat/domain/discussion-policy.ts`
- `src/chat/domain/agent-chain-policy.ts`

把原先埋在 application service 内部的规则判断提取为纯函数，包括：

- peer summary eligibility
- manual summary agent selection
- summary continuation restoration
- implicit peer continuation eligibility
- hop limit / per-agent call limit enforcement
- queueing continuation decisions

这是典型的“编排”与“规则”分离。

#### C. provider registry seam

新增：

- `src/agent-invocation/provider-capabilities.ts`
- `src/agent-invocation/provider-registry.ts`

原先 invocation 顶层包含硬编码 provider 分支；阶段 4 之后：

- `invokeAgent()` 统一通过 invocation provider registry 分发
- `invokeApiAgent()` 再通过 capability + api provider registry 选择具体 provider

当前 API provider capability 仍只有 `openai-compatible`，但扩展点已经显式建立。

#### D. runtime store seam

新增：

- `src/chat/runtime/chat-runtime-stores.ts`

把 runtime 组合里的 4 类 store 能力明确区分为：

- `sessionStore`
- `callbackMessageStore`
- `persistenceStore`
- `dependencyLogStore`

并让 `chat-runtime-persistence.ts` 从依赖整个 `ChatSessionRepository`，收窄为只依赖 `ChatRuntimePersistenceStore`。

这一步的价值在于：

- runtime 组合边界更加清晰
- persistence 不再知道 callback queue 等与自己无关的能力
- repository seam 被保留，但依赖被收窄

### 6.3 阶段 4 的架构价值

阶段 4 把剩余的“高耦合热点”继续收敛为显式 seam。

一句话概括：

> 阶段 4 让系统从“有模块”进一步走向“模块之间的边界明确且可扩展”。

---

## 7. 当前最终架构图

### 7.1 分层视图

```text
src/
  shared/
    http/

  chat/
    bootstrap/
    http/
      *-routes.ts
      *-route-helpers.ts
      ops/
    application/
    domain/
    runtime/
    infrastructure/

  admin/
    bootstrap/
    http/
    application/
    runtime/
    infrastructure/

  agent-invocation/
```

### 7.2 依赖方向

```text
server.ts / auth-admin-server.ts
  -> bootstrap
    -> http routes
      -> application services
        -> domain policies
        -> runtime facade
          -> infrastructure stores / providers
```

允许的主要依赖方向：

- HTTP 可依赖 application，但不应直接持有 infrastructure 细节
- application 可依赖 runtime / domain，但不应自己承载纯规则
- runtime 可依赖 infrastructure，但应通过更窄 seam 组合
- domain 不应依赖 HTTP / Redis / 文件 / provider

---

## 8. 阶段 1-4 完成后的收益

### 8.1 可维护性

- 大文件显著缩减职责密度
- 规则、编排、存储、协议处理不再过度混杂
- 读代码时更容易知道“应该去哪里改”

### 8.2 可扩展性

- 新增 provider 风险更低
- 新增 discussion / chain 规则有独立落点
- 新增 route parsing / response helper 不必污染 route 主体
- runtime store 可以继续演化而不强迫整体重写

### 8.3 可测试性

- integration / unit / fast 三层测试分工更明确
- 纯规则和低层边界可快速验证
- 结构性重构成本进一步下降

### 8.4 低风险演进能力

- 大部分 public behavior 已被 contract tests 锁定
- 顶层 façade 稳定，内部可持续调整
- 现有 repository seam 被保留，避免了激进替换带来的高风险

---

## 9. 当前仍保留的设计取舍

### 9.1 没有拆 `callback-message-store.ts`

这是有意保守，而不是遗漏。

原因：

- callback queue 当前接口很小
- 此时直接拆文件收益有限
- 先把 seam 抽出来已经达到“边界澄清”的目的

结论：

- 当前保留在 `ChatSessionRepository` 内实现是合理的
- 如果 callback queue 生命周期后续继续扩展，再下沉为独立 store 更合适

### 9.2 `resolveApiProviderCapability()` 仍是固定映射

当前只有 `openai-compatible` 一种 API provider capability。

因此本轮优先建立 registry seam，而不是提前抽象成复杂 provider 平台。

结论：

- 当前实现足够支撑扩展点
- 未来出现第二种 API provider 时，再把 capability 判定从 agent / connection metadata 中真实导出即可

---

## 10. 总结

阶段 1 到阶段 4 并不是 4 次互相独立的小重构，而是一条连续的架构演进链路：

- 阶段 1：建立 contract 与模块化骨架
- 阶段 2：切开 runtime / service / ops 的大职责模块
- 阶段 3：强化错误语义、调用子系统与低层测试能力
- 阶段 4：继续收敛高耦合 seam，补齐 route / policy / provider / runtime-store 边界

当前系统已经从“单点大文件驱动”显著演进为“组合根 + façade + seam + contract tests”驱动的结构。

这意味着接下来的工作重点，不再是“大拆大改”，而是围绕现有 seam 继续做更细粒度、更低风险的优化。

一句总括：

> 阶段 1-4 完成后，系统已经具备持续模块化演进的稳定基础，后续重构可以更多围绕明确边界做增量收敛，而不再需要依赖单体式重写。
