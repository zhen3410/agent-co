# Bot Room 部署说明（systemd）

本项目拆分为两个独立服务：

1. **聊天室服务**（`dist/server.js`，端口 3002）
2. **鉴权管理服务**（`dist/auth-admin-server.js`，端口 3003）

这样可以把“聊天业务”和“账号密码管理”隔离，降低安全风险。

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
sudo APP_DIR=/path/to/bot-room bash /path/to/bot-room/scripts/install-systemd.sh
```

脚本会自动完成：

- 复制 unit 文件到 `/etc/systemd/system`
- 复制环境变量模板到 `/etc/bot-room/*.env`
- `systemctl daemon-reload`
- `systemctl enable --now bot-room-auth-admin.service`
- `systemctl enable --now bot-room-chat.service`

两个服务都以 `root` 用户运行（`User=root`）。

### 3）修改生产配置

请编辑以下文件并替换默认敏感值：

- `/etc/bot-room/bot-room-auth-admin.env`
- `/etc/bot-room/bot-room-chat.env`

修改后重启服务：

```bash
sudo systemctl restart bot-room-auth-admin.service
sudo systemctl restart bot-room-chat.service
```

### 4）常用运维命令

```bash
sudo systemctl status bot-room-auth-admin.service
sudo systemctl status bot-room-chat.service
sudo journalctl -u bot-room-auth-admin.service -f
sudo journalctl -u bot-room-chat.service -f
```

## 三、默认鉴权行为

- 聊天服务默认开启鉴权（`BOT_ROOM_AUTH_ENABLED=true`）。
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

- 用户名：`BOT_ROOM_DEFAULT_USER`（默认 `admin`）
- 密码：`BOT_ROOM_DEFAULT_PASSWORD`（默认 `admin123!`）

请在生产环境中务必修改。
