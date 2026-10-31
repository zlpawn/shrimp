# 探测、安装与 registry

本文件里的 `<本 skill 目录>` 指含 SKILL.md 的 leo-video-router 目录；Windows 上把 `python3` 换成 `python`。项目名必须和下面「安装命令表」第一列完全一致（区分大小写）。

## 探测

先运行：

```bash
python3 <本 skill 目录>/scripts/registry.py locate <项目名>
```

它按顺序查找，找到第一个就停：

1. `~/.shrimp/skills/leo-video-router/registry.json` 里登记的目录（目录已失效会自动删掉这条，再继续往下找）；
2. 标准 skill 目录：`~/.agents/skills/<skill 名>`、`~/.claude/skills/<skill 名>`、`~/.codex/skills/<skill 名>`、`~/.gemini/config/skills/<skill 名>`（OpenMontage 不是 skill，跳过这一步）；
3. 默认下载目录：`~/.shrimp/skills/<项目名>`；
4. 当前工作区：`./lib/skills/<名>`、`./.agents/skills/<名>`。

`<skill 名>` 是安装后的目录名，等于 SKILL.md frontmatter 的 `name`：MoneyPrinterTurbo 是 `moneyprinterturbo-video`，其余 skill 类项目和项目名相同。目录里的入口文件必须属于这个项目（SKILL.md 的 `name` 对得上，或 OpenMontage 的 `AGENT_GUIDE.md` 文件头是 `# OpenMontage`）才算找到，随便一个 SKILL.md 不算。

| 退出码 | 输出 | 怎么做 |
|---|---|---|
| 0 | `{"name", "path", "entry", "entry_dir", "via"}` | 已安装。交接时读 `entry`，skill 目录一律取 `entry_dir`，不要自己拼路径；项目根目录取 `path` |
| 1 | `{"name", "found": false}` | 没找到，展示安装卡片 |
| 2 | stderr 打印 `usage: ...` 和 `invalid choice` | 项目名写错或大小写不对（与 `register` 的退出码 2 不同）。按安装命令表第一列改正后重跑 |
| 3 | `{"error": ...}` | registry.json 损坏或读写失败（无权限、磁盘写不进等）。把错误原文告诉用户，请用户修复或删除该文件后再继续；**不要自行覆盖或删除它** |

`locate` 没找到、但 agent 上下文里已经列出了同名的可用 skill（按上面的 `<skill 名>` 匹配，如 lemo 作为 Claude 插件装在标准目录之外）时，也算已安装，不展示安装卡片：先 `python3 <本 skill 目录>/scripts/registry.py register <项目名> <那个 SKILL.md 所在目录> --source user`，再重跑 `locate`，交接仍用 `locate` 输出的 `entry_dir`。

## 安装卡片模板

```text
💡 场景推荐：您的需求适合交给 【<项目名>】（<一句话特性>）。
当前环境未检测到它：
* 开源地址：<仓库地址>
* 安装命令：<安装命令表里该项目的命令>
* 源码目录：默认 ~/.shrimp/skills/<项目名>，也可以指定其他目录
请问是否需要我帮您安装？
* 回复「安装」：我来执行上面的命令，完成后直接接着做
* 回复「已经下载在 <目录>」：我登记这个目录，不重复下载
* 回复「直接出片」：改用通用兜底方式
```

「源码目录」一行只给 git clone 的源码类项目（OpenMontage）展示，skill 类项目删掉这一行。`<一句话特性>`、仓库地址和安装命令从 [routing-matrix.md](routing-matrix.md) 和该项目接入卡（`projects/<项目名>.md`）的 `## 安装` 节取。用户拒绝安装（包括回复「直接出片」）时按 [fallback.md](fallback.md) 处理。

## 执行规则

- **只在用户同意后执行**安装命令（用户回复「安装」「同意」「帮我装」等）。没同意之前只展示卡片。
- 源码类项目下载前先问用户要不要指定目录；不指定就用 `~/.shrimp/skills/<项目名>`。
- skill 类：`npx skills add <repo> -g -y`。`-y` 免交互；它会同时给本机检测到的其他 agent 的 skill 目录建软链。安装目录由它决定，不用问用户。
- 源码类：`git clone <url> <目录>`。OpenMontage 只能 `git clone`，**不要用 `npx skills add`**（它会装上项目内部数十个工具类 skill，不是入口）。
- 要装多个项目时**逐个**安装，等上一个结束再装下一个，不要并行（并行 clone 实测会中断）。
- 安装或 clone 失败时重试一次；仍失败就把错误告诉用户，让用户选择指定其他目录、稍后再装或「直接出片」。
- 安装命令报告成功、但紧接着 `locate` 仍退出 1：按安装失败处理，把情况告诉用户，不要自己拼路径继续。
- 装好后登记：
  - 源码类：`python3 <本 skill 目录>/scripts/registry.py register <项目名> <clone 目录> --source install`
  - skill 类：先 `locate` 确认能找到，再用它输出的 `path` 登记：`python3 <本 skill 目录>/scripts/registry.py register <项目名> <path> --source install`
- 用户说「已经下载在 <目录>」：`python3 <本 skill 目录>/scripts/registry.py register <项目名> <目录> --source user`，不重复下载。
- `register` 退出码：
  - 0：登记成功，输出这条记录；
  - 2：这个目录不是该项目（入口文件缺失，或 SKILL.md 的 `name` 对不上 / OpenMontage 文件头不对），输出的 `error` 里列出了它找过的入口文件。把错误告诉用户，让其确认路径（常见情况：给的是上一级或下一级目录）；
  - 3：registry.json 损坏或读写失败，同「探测」一节的处理。
  - 项目名写错时 argparse 同样以退出码 2 退出，但 stdout 没有 JSON、stderr 打印 `usage`，和上面的「目录不是该项目」不同。
- 依赖安装（uv、npm、ffmpeg 等）和项目自己的数据目录（如 MoneyPrinterTurbo 的 `--root`、lemo-opuscar 的 `LEMO_OPUSCAR_HOME`）按接入卡和项目自己的文档进行，Router 不管。
- 自带「全自动、不问确认」规则的项目（如 MoneyPrinterTurbo 的 skill）：先拿到用户同意再交接，交接后由它自动跑完。

## 安装命令表

| 项目 | 安装命令 | 验证情况 |
|---|---|---|
| MoneyPrinterTurbo | `npx skills add harry0703/MoneyPrinterTurbo -g -y`；源码目录用 helper 的 `--root` 指定 | `--list` 识别到 `moneyprinterturbo-video` |
| lemo-opuscar | `npx skills add lemomo-ai/lemo-opuscar -g -y`；风格库目录用 `LEMO_OPUSCAR_HOME` 指定 | `--list` 识别到 `lemo-opuscar` |
| OpenMontage | `git clone https://github.com/calesthio/OpenMontage.git <目录>`，**不要用 `npx skills add`** | `--list` 找到的是它内部 `.agents/skills/` 下的 89 个工具类 skill（threejs-*、text-to-speech 等），不是入口，全局安装会污染 skill 列表 |
| hypit | `npx skills add hypit-ai/hypit -g -y` | `--list` 识别到 `hypit` |
| huashu-art-motion | `npx skills add alchaincyf/huashu-art-motion -g -y` | `--list` 识别到 `huashu-art-motion`；仓库约 77 MB，第一次 clone 因网络中断失败，重试成功，安装失败时应重试一次 |
| video-shotcraft | `npx skills add Vincentwei1021/video-shotcraft -g -y` | `--list` 识别到 `video-shotcraft` |
| xilo-opus-video | `npx skills add Kianzzz/xilo-opus-video -g -y` | `--list` 识别到 `xilo-opus-video` |
| dashi-animationstyle | `npx skills add chuspeeism/dashi-animationstyle -g -y` | `--list` 识别到 `dashi-animationstyle` |

各项目的安装细节和注意事项见接入卡：[MoneyPrinterTurbo](projects/MoneyPrinterTurbo.md)、[lemo-opuscar](projects/lemo-opuscar.md)、[OpenMontage](projects/OpenMontage.md)、[hypit](projects/hypit.md)、[huashu-art-motion](projects/huashu-art-motion.md)、[video-shotcraft](projects/video-shotcraft.md)、[xilo-opus-video](projects/xilo-opus-video.md)、[dashi-animationstyle](projects/dashi-animationstyle.md)。

## registry.json

路径：`~/.shrimp/skills/leo-video-router/registry.json`（不在 skill 目录内，换 agent、重装 skill 都不丢）。环境变量 `LEO_VIDEO_ROUTER_HOME` 只供测试覆盖数据目录，正常使用不要设置。

```json
{
  "version": 1,
  "projects": {
    "OpenMontage": { "path": "/path/to/OpenMontage", "source": "user", "added": "2026-10-31" }
  }
}
```

- `path`：项目目录的绝对路径。
- `source`：`user`（用户指定的已有目录）或 `install`（Router 安装后写入）。
- `added`：登记日期。
- 只通过 `registry.py register` 写入，不要手工编辑；它是原子写入，不会写出半截文件。
- 失效条目（目录被移动或删除、入口文件不在了）由 `locate` 自动删除，然后继续往下探测。
- 查看全部登记：`python3 <本 skill 目录>/scripts/registry.py list`。
