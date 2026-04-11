# Docker Compose 部署设计

**日期：** 2026-04-11
**状态：** 已通过会话讨论确认，待实现
**适用范围：** 本项目的容器化构建与本地/服务器上的 Docker Compose 启动

---

## 1. 目标

为项目提供一套符合容器最佳实践的 Docker 化方案：

- 使用**单一应用镜像**承载项目代码与构建产物；
- 通过 `docker-compose.yml` 复用同一镜像启动两个应用容器：
  - `chat`：运行聊天服务，监听 `3002`；
  - `auth`：运行鉴权/管理服务，监听 `3003`；
- Redis 使用**独立容器**运行；
- 支持通过 `docker compose up --build` 一次启动整套服务；
- 运行时数据与日志具备持久化挂载点。

## 2. 非目标

- 不在单个容器中同时托管多个 Node 进程；
- 不把 Redis 打包进应用镜像；
- 不引入 Kubernetes、Helm 或额外编排层；
- 不改变现有 chat/auth 的应用职责边界。

## 3. 方案对比

### 方案 A：单容器双进程

优点：看起来“只有一个容器”。

问题：
- 违背单容器单主进程的常见实践；
- 进程管理、日志、重启策略更复杂；
- chat/auth 无法独立伸缩和健康检查。

### 方案 B：单镜像，多应用容器 + 独立 Redis（采用）

做法：
- 用一个 `Dockerfile` 产出统一应用镜像；
- `docker-compose.yml` 中分别启动 `chat`、`auth`、`redis` 三个服务；
- `chat` 与 `auth` 仅通过不同 `command` 和环境变量区分。

优势：
- 保持镜像维护简单；
- 符合容器最佳实践；
- 服务职责、日志、重启和健康检查更清晰。

## 4. 设计结论

采用 **方案 B：单镜像 + 多容器 Compose 编排**。

## 5. 具体设计

### 5.1 新增文件

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`
- 可选文档更新：`README.md`

### 5.2 Dockerfile

使用多阶段构建：

1. **build 阶段**
   - 安装依赖；
   - 复制源码与静态资源；
   - 执行 `npm run build`；
   - 裁剪为生产依赖。

2. **runtime 阶段**
   - 仅复制 `dist/`、`public/`、`public-auth/`、`node_modules/`、`package*.json`；
   - 创建 `data/` 与 `logs/` 目录；
   - 默认命令可保持为 chat 服务，Compose 再覆盖 auth 服务启动命令。

### 5.3 Compose 服务定义

#### `redis`
- 使用官方 Redis 镜像；
- 提供健康检查；
- 使用独立 volume 持久化数据。

#### `auth`
- 基于本项目镜像；
- 运行 `node dist/auth-admin-server.js`；
- 暴露 `3003`；
- 挂载 `data/` 与 `logs/`；
- 从环境变量读取管理端 token、默认用户数据路径等。

#### `chat`
- 基于本项目镜像；
- 运行 `node dist/server.js`；
- 暴露 `3002`；
- 挂载 `data/` 与 `logs/`；
- `AUTH_ADMIN_BASE_URL` 指向 Compose 网络内的 `http://auth:3003`；
- Redis URL 指向 Compose 网络内的 `redis` 服务。

### 5.4 配置兼容性

当前聊天服务对 Redis 使用固定默认值 `redis://127.0.0.1:6379`。为支持容器网络，需要扩展为：

- 优先读取 `REDIS_URL`；
- 未设置时继续回退到 `redis://127.0.0.1:6379`。

这是本次唯一必要的应用代码改动，且保持向后兼容。

### 5.5 持久化

- `data/`：用户、agent、group、API connection 等运行数据；
- `logs/`：运行日志。

Compose 将为应用容器挂载命名卷，避免容器销毁后数据丢失。

### 5.6 验证方式

至少验证：

1. `npm run build` 成功；
2. 与 `REDIS_URL` 相关的配置测试通过；
3. `docker compose config` 成功解析；
4. `docker compose build` 能完成镜像构建（若当前环境可用）。

