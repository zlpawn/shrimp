# Mutagen 引擎专属规约与排错指南

本文档记录 `mutagen` CLI 的详细命令标准、参数规约、会话管理和异常排错方案，供 Agent 按需查阅。

---

## 1. 核心命令集

### ① 创建同步会话 (`mutagen sync create`)
```bash
mutagen sync create <LOCAL_PATH> <REMOTE_URL> \
  --name=<SESSION_NAME> \
  --sync-mode=two-way-resolved \
  --ignore="<RULE1>" \
  --ignore="<RULE2>"
```
* **非默认 SSH 端口**：
  格式为 `user@host:port:remote_path`，例如：
  `pa@39.105.19.237:6007:/home/pa/myproject`
* **推荐同步模式**：
  * `two-way-resolved`（推荐，双向同步，若有冲突自动研判）；
  * `two-way-safe`（双向同步，若有冲突自动暂停并提示）。

### ② 查看状态 (`mutagen sync list`)
```bash
mutagen sync list [SESSION_NAME]
```
* **健康状态判定**：
  * `Status: Watching for changes`：正常健康运行中；
  * `Status: Scanning ...`：正在全量或增量扫描；
  * `Status: Reconciling ...`：两端正在对比差异；
  * `Status: Transitioning ...`：正在网络传输；
  * `Status: Halted / Problems`：异常中断（需要排查网络、权限或路径）。

### ③ 暂停与恢复
```bash
mutagen sync pause <SESSION_NAME>
mutagen sync resume <SESSION_NAME>
```

### ④ 强制刷写 (`flush`)
当用户需要立刻确认所有改动已经落地远端时：
```bash
mutagen sync flush <SESSION_NAME>
```

### ⑤ 彻底终止会话 (`terminate`)
```bash
mutagen sync terminate <SESSION_NAME>
# 或终止全部
mutagen sync terminate --all
```

---

## 2. 守护进程管理 (`mutagen daemon`)

Mutagen 依赖后台轻量守护进程：
* 检查状态：`mutagen daemon status`
* 启动：`mutagen daemon start`（通常创建同步时会自动拉起）
* 停止：`mutagen daemon stop`（在卸载 CLI 前必须先停止）

---

## 3. 常见异常与排错自愈

### Q1: `connection refused` 或 `connection timed out`
* **原因**：IP 填写错误、安全组端口未放行，或 SSH 端口不是默认的 22 端口。
* **排查**：在终端单独执行 `ssh -p <PORT> <USER>@<HOST>` 验证连通性。

### Q2: `permission denied` (publickey, password)
* **原因**：认证凭据错误或公钥未写入。
* **排查**：检查 `hosts.json` 中配置的密码是否过期，或者重新通过 `SSH_ASKPASS` 认证。

### Q3: `conflict detected` (代码冲突)
* **原因**：本地和远程在同一个文件的同一位置同时被修改。
* **处理**：
  1. 查看冲突文件：`mutagen sync list <SESSION_NAME>`
  2. 用户手动或通过 Agent 保留所需一侧的内容；
  3. 执行 `mutagen sync flush <SESSION_NAME>` 恢复。
