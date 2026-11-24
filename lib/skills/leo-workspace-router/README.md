# Leo Workspace Router

面向跨端工作区协同与远程开发的场景驱动通用同步中枢。

## 🌟 核心特性

1. **场景优先架构**：首期深度集成 `mutagen`，支持毫秒级双向实时同步，免除网络磁盘挂载卡顿；预置接口未来可扩充 `rsync` 与 `rclone`。
2. **CLI 全生命周期自愈**：支持跨平台（macOS / Windows / Linux）自动探针、一键 JIT 安装与优雅安全卸载。
3. **多主机凭据安全隔离**：持久化至 `~/.shrimp/skills/leo-workspace-router/hosts.json`（权限 `0600`），支持进程级 `SSH_ASKPASS` 动态应答，多主机互不干扰且绝无密码泄露。
4. **智能工程黑名单**：内置防卡顿规则预设，自动排除 `node_modules`、`.git`、`__pycache__`、`dist` 等无用零碎文件。

## 📁 目录结构

```text
lib/skills/leo-workspace-router/
├── SKILL.md                  # 核心技能规范（Agent 意图识别与极简路由）
├── README.md                 # 技能说明文档
├── package.json              # 依赖与脚本定义
├── references/
│   ├── engines-catalog.md    # 引擎能力画像与路由决策表
│   ├── ignore-presets.md     # 跨语言通用智能过滤预设
│   └── engines/
│       └── mutagen.md        # Mutagen CLI 专属详细规约与排错手册
└── scripts/
    ├── probe.mjs             # 运行期环境与引擎状态探针
    ├── config.mjs            # 主机配置持久化与权限守护
    ├── askpass.mjs           # 进程级 SSH_ASKPASS 密码桥接脚本
    ├── router.mjs            # 统一 CLI 交互调度器
    └── engines/
        └── mutagen.mjs       # Mutagen 专属适配器（安装/卸载/会话管理）
```

## 🚀 常用测试指令

```bash
# 1. 探针自检
node scripts/router.mjs probe

# 2. 添加测试主机
node scripts/router.mjs add-host test-mac --host="39.105.19.237" --port=6007 --user="pa" --password="sample_password"

# 3. 查看主机列表（脱敏检查）
node scripts/router.mjs list-hosts

# 4. 删除测试主机
node scripts/router.mjs remove-host test-mac
```
