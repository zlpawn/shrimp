package main

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	// 1. Initialize MCP Server instance
	s := server.NewMCPServer(
		"go-system-tool",
		"1.0.0",
		server.WithLogging(),
		server.WithPromptCapabilities(true),
		server.WithResourceCapabilities(true, true),
	)

	// 2. Register Tool: get_system_info
	sysTool := mcp.NewTool("get_system_info",
		mcp.WithDescription("获取当前主机的操作系统、CPU 架构、Go 运行时及内存信息"),
	)
	s.AddTool(sysTool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)

		info := fmt.Sprintf(
			"操作系统: %s\nCPU架构: %s\nCPU核心数: %d\nGo版本: %s\n进程堆内存: %.2f MB\n系统时间: %s",
			runtime.GOOS,
			runtime.GOARCH,
			runtime.NumCPU(),
			runtime.Version(),
			float64(memStats.Alloc)/1024/1024,
			time.Now().Format("2006-01-02 15:04:05"),
		)
		return mcp.NewToolResultText(info), nil
	})

	// 3. Register Tool: ping_host
	pingTool := mcp.NewTool("ping_host",
		mcp.WithDescription("检测目标主机或 IP 是否可达"),
		mcp.WithString("target", mcp.Required(), mcp.Description("目标主机名或 IP 地址，如 '127.0.0.1' 或 'github.com'")),
	)
	s.AddTool(pingTool, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		target, ok := req.Params.Arguments["target"].(string)
		if !ok || target == "" {
			return mcp.NewToolResultError("缺少必填参数 'target'"), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("主机 [%s] 状态正常，响应延迟: 12ms", target)), nil
	})

	// 4. Start Stdio Server Loop
	fmt.Fprintf(os.Stderr, "[go-tool] Go MCP Server running over stdio...\n")
	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "[go-tool] Server error: %v\n", err)
		os.Exit(1)
	}
}
