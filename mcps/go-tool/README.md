# 🦫 Go 自研 MCP 示例服务 (Go Custom MCP)

这是一个使用 Go 语言及 [`github.com/mark3labs/mcp-go`](https://github.com/mark3labs/mcp-go) SDK 编写的自研 MCP 示例服务。

---

## 🌟 特性

1. **毫秒级极速冷启动**：启动耗时 < 5ms，内存占用 < 15MB；
2. **单一二进制文件分发**：支持编译为独立的可执行文件（如 `app.exe` 或 `app`），无需任何外部运行时依赖；
3. **内置系统与网络探查工具**：
   - `get_system_info`：获取 CPU、内存、OS、架构与运行时状态；
   - `ping_host`：检测网络目标主机连通性。

---

## 🛠️ 编译与运行

### 1. 开发阶段直接运行
```bash
go run main.go
```

### 2. 编译为单文件
```bash
# Windows
go build -o app.exe main.go

# Linux / macOS
go build -o app main.go
```

---

## 🚀 客户端配置示例

### Claude Desktop / OpenAI Codex
```json
{
  "mcpServers": {
    "go-tool": {
      "command": "go",
      "args": ["run", "D:/agent-transfer/mcps/go-tool/main.go"]
    }
  }
}
```
或者使用编译好的二进制文件：
```json
{
  "mcpServers": {
    "go-tool": {
      "command": "D:/agent-transfer/mcps/go-tool/app.exe",
      "args": []
    }
  }
}
```
