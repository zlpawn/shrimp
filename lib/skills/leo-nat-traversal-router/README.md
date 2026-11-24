# Leo NAT Traversal Router

`leo-nat-traversal-router` 是一个场景驱动、面向 Agent 协同的内网穿透智能路由技能。

## 特色能力
- **自包含与解耦**：不依赖任何特定桌面或宿主框架，独立脚本执行。
- **~/.local/bin 干净安装**：免 sudo、零系统污染，随时一键卸载。
- **进程生命周期守护**：支持启动、停止、守护与外部已有进程自动接管（Adoption）。
- **可插拔架构**：首发提供 `frp`，预留 `cloudflare` 等扩展插槽。
- **凭证安全隔离**：敏感 Token 权限严格控制（0600），安全防护。

## 目录结构
```text
leo-nat-traversal-router/
├── SKILL.md                 # Agent 核心规约
├── README.md                # 技能说明
├── package.json             # 快捷指令
├── references/              # 深度手册（routing-matrix, providers/frp.md）
├── scripts/                 # 自动化脚本套件
│   ├── probe.mjs            # 探针脚本
│   ├── router.mjs           # 统一 CLI 调度器
│   ├── core/                # 跨工具公共库（system, port）
│   └── providers/           # 各工具自治目录（frp/）
└── tests/                   # 自动化测试
```
