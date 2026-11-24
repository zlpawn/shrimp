# FRP 提供者技术参考手册 (FRP Provider Reference)

## 📖 核心概念与组件

- **`frpc` (Client)**: 部署在当前本地内网机器的客户端，负责发起连接并建立长连接隧道。
- **`frps` (Server)**: 部署在具备公网 IP 的服务器上的服务端，负责接收外部请求并按规则转发。
- **配置持久化**:
  - 公开配置：`~/.shrimp/skills/leo-nat-traversal-router/config/config.json`
  - 敏感凭证：`~/.shrimp/skills/leo-nat-traversal-router/config/secrets.json` (chmod 0600)
  - 最终 TOML：`~/.shrimp/skills/leo-nat-traversal-router/config/frpc.toml`
  - 进程与日志：`~/.shrimp/skills/leo-nat-traversal-router/run/frpc.pid` 与 `logs/frpc.log`

---

## ⚙️ TOML 配置格式 (v0.52+ 现代化格式)

```toml
# 核心连接配置
serverAddr = "120.xx.xx.xx"
serverPort = 7000
auth.token = "my_secure_token"
log.to = "console"
log.level = "info"

# TCP 代理示例 (将本地 8080 映射到公网服务器的 18080)
[[proxies]]
name = "web-dev"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8080
remotePort = 18080

# SSH 代理示例
[[proxies]]
name = "ssh-local"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
```

---

## 🛠️ CLI 常用操作示例

```bash
# 1. 探针与环境检查
node scripts/router.mjs probe

# 2. 安装 frpc 到 ~/.local/bin/frpc
node scripts/router.mjs frp install

# 3. 配置服务端地址与 Token (Token 会被安全写入 secrets.json)
node scripts/router.mjs frp set-server --addr="120.xx.xx.xx" --port=7000 --token="my_token"

# 4. 检查本地 8080 端口是否就绪
node scripts/router.mjs check-port --port=8080

# 5. 添加代理映射
node scripts/router.mjs frp add-proxy --name="web" --port=8080 --remote=18080 --type="tcp"

# 6. 启动穿透
node scripts/router.mjs frp start

# 7. 查看日志与状态
node scripts/router.mjs frp status
node scripts/router.mjs frp logs --lines=20

# 8. 停止穿透
node scripts/router.mjs frp stop
```

---

## 🚨 常见故障与排错指南

1. **连接服务端超时 (`i/o timeout` / `connection refused`)**:
   - 检查公网 VPS 的云服务商**安全组 / 防火墙**是否开放了 `serverPort`（默认 7000）以及各 `remotePort`（如 18080）；
   - 检查 `serverAddr` 是否解析正确。
2. **鉴权失败 (`token authorization failed`)**:
   - 客户端配置的 `auth.token` 与服务端 `frps.toml` 中的 `auth.token` 不一致，重新运行 `frp set-server --token=...`。
3. **远程端口已被占用 (`port already used`)**:
   - 说明服务端已有其他客户端占用了相同的 `remotePort`，尝试更换新的远程端口。
4. **外部已有进程接管 (Adoption)**:
   - 若系统先前已通过其他脚本或手动启动了 `frpc`，`status` 命令会自动检测该进程并进入 `adopted` 接管模式，避免端口抢占冲突。
