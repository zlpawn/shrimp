package main

import (
	"fmt"
	"os"
)

// Go 自研 MCP 开发模板入口
// 待后续需要实现具体功能时，可引入 MCP SDK（如 github.com/mark3labs/mcp-go）并编写相应 Tools 与 Prompts
func main() {
	fmt.Fprintf(os.Stderr, "[go-mcp] Go MCP 服务开发脚手架已就绪\n")
}
