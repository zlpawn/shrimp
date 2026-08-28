# Wendao CLI

携程问道 Skill + CLI 接入。CLI 负责调用携程问道 API、处理短确认语重试和 token 安全；Skill 只指导 agent 何时调用。

## 安装

在 Shrimp 中执行：

```bash
shrimp cli install wendao
```

首次配置 token：

```bash
wendao login
```

交互输入不会回显。凭据默认保存在 `~/.shrimp/secrets/wendao/token`，目录 700、文件 600，可通过 `SHRIMP_SECRETS_DIR` 覆盖。环境变量 `WENDAO_API_KEY` 优先于文件。

## 查询

```bash
wendao "国庆去成都怎么玩"
```

stdout 只包含问道返回的 Markdown `result`；stderr 放置安全化后的错误信息。API 返回中的 `state`（会回显 token）永远不会透传。
