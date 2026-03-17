# Integration Tests

本目录提供以集成为主的测试框架，当前覆盖鉴权管理服务（`auth-admin-server`）的关键业务流程。

## 结构

- `integration/auth-admin-server.integration.test.js`：核心集成用例。
- `integration/helpers/auth-admin-fixture.js`：测试夹具（环境搭建、服务拉起、HTTP 请求封装、资源清理）。

## 运行方式

```bash
npm test
```

或仅执行集成测试：

```bash
npm run test:integration
```

## 环境搭建说明

测试框架会在每个用例开始时自动完成：

1. 创建独立临时目录用于用户与智能体数据文件；
2. 以随机端口启动 `dist/auth-admin-server.js`；
3. 注入测试专用环境变量（`AUTH_ADMIN_TOKEN`、`AUTH_DATA_FILE`、`AGENT_DATA_FILE` 等）；
4. 轮询 `/healthz`，确认服务可用后执行用例；
5. 用例结束后自动停止进程并清理临时目录。

因此用例间相互隔离，可并行扩展。
