# 🦫 Go 自研 MCP 开发脚手架 (Go MCP Starter)

本目录为当前仓库自研 Go MCP 的预留开发目录。

---

## 📁 目录结构

```text
mcps/go-tool/
├── go.mod        # Go 模块定义
├── main.go       # 待实现的主入口源码
└── README.md     # 开发指南
```

---

## 🛠️ 后续开发指引

当需要使用 Go 语言开发具体 MCP 服务时：
1. 引入 Go MCP SDK：
   ```bash
   go get github.com/mark3labs/mcp-go
   ```
2. 在 `main.go` 中注册 Tools、Resources 或 Prompts；
3. 网关会自动扫描感知当前目录，并支持一键分发到 Claude Desktop / Codex！
