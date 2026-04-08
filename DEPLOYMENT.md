# agent-co 部署说明（systemd）

本项目包含两个协同服务，通过单个 systemd unit (`agent-co.service`) 统一管理：

1. **鉴权管理服务**（`dist/auth-admin-server.js`，端口 3003）
2. **聊天室服务**（`dist/server.js`，端口 3002）

启动脚本 `scripts/start-services.sh` 保证鉴权服务先就绪，再启动聊天服务。

## 一、编译

```bash
npm install
npm run build
```

## 二、使用 systemd 启动服务（推荐）

### 1）部署目录

```bash
cd <你的部署目录>
```

> 默认部署目录为你执行安装脚本时所在仓库根目录；也可通过环境变量 `APP_DIR` 显式指定。

### 2）执行一键安装脚本

```bash
cd <你的部署目录>
sudo bash scripts/install-systemd.sh
```

或：

```bash
sudo APP_DIR=/path/to/agent-co bash /path/to/agent-co/scripts/install-systemd.sh
```

脚本会自动完成：

- 移除旧的双服务 unit（如有）
- 复制 unit 文件到 `/etc/systemd/system`
- 合并或生成环境变量文件 `/etc/agent-co/agent-co.env`
- `systemctl daemon-reload`
- `systemctl enable --now agent-co.service`

### 3）修改生产配置

请编辑以下文件并替换默认敏感值：

- `/etc/agent-co/agent-co.env`

修改后重启服务：

```bash
sudo systemctl restart agent-co.service
```

### 4）常用运维命令

```bash
sudo systemctl status agent-co.service
sudo systemctl restart agent-co.service
sudo journalctl -u agent-co.service -f
```

## 三、默认鉴权行为

- 聊天服务默认开启鉴权（`AGENT_CO_AUTH_ENABLED=true`）。
- 聊天服务不会直接读取密码，而是调用鉴权服务的 `/api/auth/verify`。
- 前端登录使用 **用户名 + 密码**。

## 四、鉴权管理 API（建议仅内网开放）

鉴权服务管理接口需要请求头：`x-admin-token`。

- `GET /api/users`：查看用户列表
- `POST /api/users`：新增用户
- `PUT /api/users/:name/password`：重置密码
- `DELETE /api/users/:name`：删除用户（至少保留 1 个）

示例：

```bash
curl -X POST http://127.0.0.1:3003/api/users \
  -H 'Content-Type: application/json' \
  -H 'x-admin-token: please-change-this-token' \
  -d '{"username":"ops","password":"StrongPass123!"}'
```

## 五、首次启动默认账号

若 `AUTH_DATA_FILE` 不存在，鉴权服务会自动创建文件并写入默认用户：

- 用户名：`AGENT_CO_DEFAULT_USER`（默认 `admin`）
- 密码：`AGENT_CO_DEFAULT_PASSWORD`（默认 `admin123!`）

请在生产环境中务必修改。
