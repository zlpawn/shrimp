# leo-lc-transcoder 设计

日期：2026-11-01
状态：待用户审阅

## 1. 目标与问题

**目标：帮用户通过严格的算法面试。**

用户的痛点：每次面试前都刷题，但刷完就忘；面试遇到没做过的题做不出来；做过的题也会在面试中遗忘。用户算法基础薄弱。

因此本 skill 的重点不是"讲懂这一道题"，而是两件事：

1. **识别题型**：见到新题，能从题面信号判断属于哪个题型。
2. **掌握模板**：每个题型有固定骨架，单题 = 模板 + 改动点。

知识按"题型卡 ↔ 单题卡"两层沉淀到 Obsidian，用 `[[双链]]` 连起来，供其他 agent 按题型或按题出题复习。

## 2. 已确定的约束

| 项 | 决定 |
|---|---|
| skill 名称与位置 | `leo-lc-transcoder`，放在 `lib/skills/leo-lc-transcoder/`，并登记到 `lib/skills/managed-catalog.json` |
| 站点 | 只支持 leetcode.com；leetcode.cn 暂不支持，但站点代码隔离在 `scripts/sites/<site>/`，留出扩展点 |
| 编程语言 | 讲解、模板、提交统一用 Java |
| 显示语言 | 由 `config.json` 的 `display_lang` 决定，默认 `zh`；agent 实时翻译题面 |
| 题目标题 | 显示为"题号. 中文名"（如 `1. 两数之和`）；英文 slug 只存在元数据中，供接口和链接使用 |
| 知识库 | `/Users/pa/project/OBDI/bg/nightmare/LC-Agent-Wiki`，路径记在 config 中 |
| 运行时依赖 | 只依赖 Node.js 20+ 自带能力（`fetch`、`http`、`node --test`）和本机 JDK；**不依赖 ego-browser、lantern CLI 或任何 npm 包** |
| 跨平台 | 遵循 `lib/skills/README.md`：macOS 与 Windows 都能运行 |
| 讲解风格 | 沿用 `leo-ai-transcoder`：一轮一个点、先故事后术语、术语当场点出、手算小练习、答错逐步演算 |

## 3. 目录结构

```
lib/skills/leo-lc-transcoder/
├── SKILL.md                      # 首次配置、解题四问、四种模式、沉淀规则
├── references/
│   ├── teaching-examples.md      # 讲题示范：好的一轮 vs 差的一轮
│   ├── pattern-catalog.md        # 题型目录：识别信号、Java 模板、数据规模→复杂度对照表
│   └── card-templates.md         # 题型卡、单题卡、LEARNING.md、复习队列.base 的格式
├── assets/
│   ├── player.html               # 通用算法动画播放器模板
│   └── T.java                    # 轨迹记录辅助类
├── scripts/
│   ├── lc.mjs                    # 统一入口，按 config.site 分发
│   ├── viz.mjs                   # 轨迹 JSON + player.html → 独立 HTML
│   └── sites/leetcode-com/
│       ├── cookie.mjs            # 通过 19527 拿 cookie，拿到即退出
│       └── api.mjs               # leetcode.com 接口封装
└── tests/                        # node --test，不访问网络
```

用户级配置与缓存在 `~/.shrimp/skills/leo-lc-transcoder/`：

- `config.json`：`site`、`display_lang`、`vault_root`、`java_home`、`updated_at`
- `credentials.json`：`LEETCODE_SESSION`、`csrftoken`、获取时间；文件权限 600；脚本输出中不得打印 cookie 值

首次使用协议同 transcoder：config 不存在时暂停主流程，询问路径并写回；本次用不到的配置项不打扰用户。

## 4. 登录态：cookie.mjs

复用 Chrome 上已安装的 `Leo cookie.txt Locally` 扩展（`extensions/leo-cookie-txt-locally`），不修改扩展，只写一个脚本。

扩展的协议（已从源码确认）：扩展会周期性地向 `http://127.0.0.1:19527` 发请求，`POST /ext/hello`、`POST /ext/heartbeat` 用于注册和心跳，`GET /ext/poll?waitMs=` 用于领取任务（返回 `{ok, cmd}`），执行完通过 `POST /ext/result` 回传 `{id, ok, result}`。`cookies.export` 任务的参数为 `{domain}`，扩展返回 `{cookies, count}`。

流程：

1. `GET 127.0.0.1:19527/health`。如果已有桥接服务（lantern 或网关），直接 `POST /cmd {type:"cookies.export", params:{domain:"leetcode.com"}}`。
2. 如果端口上没有服务，脚本在 19527 上临时扮演桥接服务：实现上述 4 个 `/ext/*` 接口，任务入队后等扩展来领取。
3. 拿到结果，或等待超过 60 秒，**立即关闭 server 并退出进程**。超时时提示"请打开 Chrome 并确认扩展已启用"。
4. 只保留 `LEETCODE_SESSION` 和 `csrftoken`，写入 credentials.json，再调用 LeetCode 的当前用户接口校验是否已登录。

其他脚本发现 cookie 失效（未登录或 403）时，自动执行一次 `login` 再重试；仍失败则报错，不进入循环。

## 5. 接口脚本：lc.mjs

`node scripts/lc.mjs <命令>`，所有输出都是 JSON。

| 命令 | 作用 |
|---|---|
| `login` | 执行 cookie.mjs 并校验 |
| `search <关键词\|题号>` | 搜题，返回题号、标题、slug、难度、标签、是否已通过 |
| `show <题号\|slug>` | 题面 HTML/文本、示例、约束、图片 URL 列表、Java 代码模板、标签 |
| `run <题号> <文件> [--input 文件]` | 运行测试并轮询结果 |
| `submit <题号> <文件>` | 提交并轮询判题结果，返回状态、运行时间、失败用例 |
| `solutions <题号> [--top N]` | 按投票排序的 Java 题解列表与正文 |

**接口细节在实现阶段用 ego-browser 实际抓取确认**（GraphQL 查询名与字段、提交地址、结果轮询方式、请求头里的 `x-csrftoken` / `Referer` 要求），不凭记忆写。ego-browser 只在开发时使用，最终脚本只发普通 HTTP 请求。

站点扩展点：`lc.mjs` 读取 `config.site`，加载 `sites/<site>/api.mjs`，后者导出与上表同名的函数。新增站点 = 新增一个目录。

## 6. 标准答案的选取

单题卡里的"标准解法"优先从 `solutions --top 5` 返回的高票 Java 题解中选，按以下顺序筛选：

1. 用的是该题型的通用模板（能和题型卡对上）；
2. 时间复杂度达到最优或接近最优；
3. 在满足以上两条的前提下，选最容易理解的：代码短、变量名清楚、没有花哨技巧。

如果高票解都很取巧，就选其中最好懂的一个作为标准解法，把最优但难懂的解法放到"进阶解法"小节，标注为可选。卡片注明题解来源链接和作者。用户自己通过提交的代码另外放在"我的提交"小节。

## 7. 算法动画：viz.mjs + player.html

原则：**图上的每一步都来自真实运行的代码**，不手写动画逻辑。

1. agent 写 Java 解法，在关键位置插入 `T.frame("中文说明", 视图...)`，记录当前状态。行号由 T 从调用栈自动取得，不用手写。
2. `viz.mjs` 把 `assets/T.java` 作为顶层类 `class T` 追加到解法文件末尾，然后用 `java Solution.java` 运行（单文件源码启动，无需编译；JDK 11–21 只会编译这一个文件，所以 T 必须写在同一个文件里；启动器运行文件里第一个顶层类，所以带 `main` 的类要写在最前面），每帧输出一行 JSON（以 `@@T ` 开头）。
3. 以上由一条命令完成：`node scripts/viz.mjs Solution.java --out <vault>/assets/LC0003.html`。运行结束后，把帧和代码嵌入 player.html，生成可以离线打开的单个 HTML。
4. 播放器提供上一步、下一步、自动播放和调速；每一帧高亮当前代码行，并显示一句中文说明。

第一版支持 4 种渲染器，一帧可以组合多种：

| 渲染器 | 覆盖 |
|---|---|
| 数组 + 指针 + 区间 | 双指针、滑动窗口、二分、前缀和、单调栈 |
| 网格 / 表格 | 动态规划、矩阵、BFS 网格 |
| 树 | 二叉树、递归树、回溯决策树 |
| 栈 / 调用栈 | 递归展开与返回 |

图（graph）结构第二版再做。触发时机：核心思路讲完后询问用户是否要看动画，或用户说"没看懂"时。卡片正文始终保留 ASCII 状态图作为兜底。

anatomy 不放进主流程；以后可以给核心题型画精品静态 SVG，作为可选增强。

## 8. 教学流程

### 8.1 解题四问（每道题都走一遍）

1. **看数据规模**，判断允许的复杂度（对照表在 pattern-catalog.md）；
2. **暴力解**怎么做，复杂度多少；
3. 暴力解的**瓶颈**：哪里在重复计算；
4. 哪个**题型 / 数据结构**能消除重复，依据是题面里的什么信号。

### 8.2 四种模式

**A. 学一道题**（一轮一步）

1. 展示中文题面、图片和示例，先让用户试着答四问的前两问；
2. 讲暴力解，说明为什么会超时；
3. 识别题型；如果已有对应题型卡，点明"和你学过的 X 是同一类"；
4. 讲核心思路：先故事后术语，配 ASCII 手算练习，询问是否看动画；
5. 套模板：列出模板，标出本题改动的地方；
6. 写代码：初期只填模板里的改动行，熟练后完整写；`run` → `submit`，失败时逐步演算失败用例；
7. 讲复杂度，用户用术语复述 30 秒面试说法，介绍一个变体，推荐同题型下一题；
8. 询问是否沉淀。

**B. 学一个题型**：识别信号 + 模板 → 模板题 / 变体题 / 综合题各一道，每道走 A 的流程，讲过的部分压缩 → 产出题型卡。

**C. 陌生题测试**：从已学题型中挑一道知识库里没有的题，只给题面。三级提示，每次只给一级：信号 → 题型 → 模板。

**D. 复习**：取 `next_review ≤ 今天` 的题，只给题面，用户说出题型和思路后再对照卡片。间隔为 1、3、7、14、30 天；用了提示就缩短间隔，想不起来就重置为 1 天并重讲。

### 8.3 严格面试规则（C、D 两种模式）

- 计时：真实面试的算法环节一般最多 10～15 分钟，所以 Easy 限时 10 分钟，Medium 和 Hard 都是 15 分钟；超时记为未达标；
- 先口头讲出思路和复杂度，再写代码；
- 写完先自己检查边界，然后才允许 `run` / `submit`；
- 单独记录"一次提交是否通过"。

### 8.4 掌握度

| 级别 | 含义 |
|---|---|
| 0 | 未学 |
| 1 | 看懂了 |
| 2 | 有提示能做出 |
| 3 | 独立做出 |
| 4 | 限时内一次提交就通过，并能讲清思路和复杂度 |

**面试可用 = 4 级。** `LEARNING.md` 的题型掌握度表按此标准统计。

## 9. 知识库结构

遵循 vault 的 `SCHEMA.md`（UTF-8、frontmatter、每页至少 2 个 wikilink、更新 index 和 log），目录结构参照同级的 `AI-Agent-Wiki`：

```
LC-Agent-Wiki/
├── LEARNING.md          # 唯一进度文件：目标、面试窗口、题型掌握度表、学习记录
├── 00-Meta/
│   ├── index.md         # 题型地图：学习顺序 + 各题型下的题目
│   ├── log.md
│   └── 复习队列.base     # Obsidian Bases 视图：next_review ≤ today
├── 题型/                 # P03_滑动窗口.md
├── 题目/                 # LC0003_无重复字符的最长子串.md
└── assets/              # 题面图片（下载到本地）、动画 HTML
```

**题型卡**：一句话结论、术语速查表、识别信号、四问中第 3、4 问在本题型的落点、带注释的 Java 模板、模板变化点表、ASCII 演示 + 动画链接、易错点、30 秒面试说法、题目清单（链接 / 难度 / 掌握度）。

**单题卡**：中文题面 + 图片（`![[...]]`）+ 折叠的英文原文、四问、暴力解、题型（`[[题型卡]]`）、核心思路（ASCII + 动画链接）、模板差异、标准解法（见第 6 节）、我的提交、复杂度、边界、面试说法、练习（题目 / 规范答案 / 易错点）、相关题。

复习状态只存一份，写在单题卡的 frontmatter 中：

```yaml
site: leetcode-com
id: 3
slug: longest-substring-without-repeating-characters
difficulty: Medium
patterns: ["[[P03_滑动窗口]]"]
mastery: 2
next_review: 2026-11-04
interval: 3        # 当前复习间隔档（1/3/7/14/30 天）
reviews: 1
last: { hints: 1, minutes: 18, first_submit_ac: false }
```

沉淀规则沿用 transcoder：先写草稿给用户预览，确认后再写入知识库；逐条核对对话中的提问与要点，确保没有遗漏；卡片里不收录用户原话；用户暂缓的内容记入 LEARNING.md 待办。

## 10. 测试

- `cookie.mjs`：用假扩展客户端（按协议发 poll/result）测试临时桥接模式；测试借用已有桥接服务的模式；测试超时退出、server 已关闭、进程不残留。
- `api.mjs`：用录制的响应样本测试解析与错误映射（未登录、403、判题中轮询）。
- `viz.mjs`：用样例帧生成 HTML，校验帧数据已嵌入、产物不引用任何外部资源。
- 真实联网的冒烟测试（login / search / show / run / submit / solutions）手动执行一次，不进入自动测试。

## 11. 不在本期范围

- leetcode.cn 及其他站点；
- graph 渲染器；
- anatomy 精品图；
- 自动同步 LeetCode 提交记录。
