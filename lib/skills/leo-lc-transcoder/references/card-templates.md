# 卡片与知识库格式

知识库根目录取自 config 的 `vault_root`。若 Obsidian vault 根目录有 `SCHEMA.md`，必须遵守：UTF-8 编码、新页面带 frontmatter、每页至少 2 个 `[[wikilink]]`、更新 index 和 log。新标签要先登记到 SCHEMA 的标签 taxonomy，本 skill 用到的标签是 `interview`、`algorithm`、`leetcode`。

## 知识库初始化

`vault_root` 下没有 `LEARNING.md` 时，创建以下骨架（`YYYY-MM-DD` 填今天的日期）：

```
LEARNING.md
00-Meta/index.md
00-Meta/log.md
00-Meta/复习队列.base
题型/
题目/
assets/
```

### LEARNING.md

```markdown
---
title: LeetCode 算法面试学习计划
type: learning-plan
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
---

# LeetCode 算法面试学习计划（唯一进度文件）

## 目标

通过严格的算法面试：算法环节 10～15 分钟，通常不能运行代码，面试官会追问复杂度和边界。

- 面试时间窗口：（初始化时询问用户后填写）
- 面试可用 = 掌握度 4 级：限时内一次提交就通过，并能讲清思路和复杂度。

## 题型掌握度

| 题型 | 已学题数 | 4 级题数 | 最近复习 | 备注 |
|---|---|---|---|---|
| [[P01_哈希表]] | 0 | 0 | - | |
| [[P02_双指针]] | 0 | 0 | - | |
| [[P03_滑动窗口]] | 0 | 0 | - | |
| [[P04_前缀和]] | 0 | 0 | - | |
| [[P05_二分查找]] | 0 | 0 | - | |
| [[P06_单调栈]] | 0 | 0 | - | |
| [[P07_链表]] | 0 | 0 | - | |
| [[P08_二叉树递归]] | 0 | 0 | - | |
| [[P09_BFS]] | 0 | 0 | - | |
| [[P10_回溯]] | 0 | 0 | - | |
| [[P11_动态规划]] | 0 | 0 | - | |
| [[P12_堆]] | 0 | 0 | - | |
| [[P13_图与拓扑排序]] | 0 | 0 | - | |

## 待办

（用户说暂缓的内容记在这里）

## 学习记录

| 日期 | 模式 | 题目 / 题型 | 结果 | 用时 | 提示级数 | 一次提交通过 |
|---|---|---|---|---|---|---|
```

### 00-Meta/index.md

```markdown
---
title: LC-Agent-Wiki 题型地图
type: moc
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
---

# 题型地图

建议学习顺序：P01 → P02 → P03 → P04 → P05 → P07 → P08 → P09 → P10 → P11 → P06 → P12 → P13。进度见 [[LEARNING]]。

## [[P01_哈希表]]
## [[P02_双指针]]
## [[P03_滑动窗口]]
## [[P04_前缀和]]
## [[P05_二分查找]]
## [[P06_单调栈]]
## [[P07_链表]]
## [[P08_二叉树递归]]
## [[P09_BFS]]
## [[P10_回溯]]
## [[P11_动态规划]]
## [[P12_堆]]
## [[P13_图与拓扑排序]]
```

每沉淀一道题，在对应题型下追加一行：`- [[LC0003_无重复字符的最长子串]] Medium · 一句话要点`。

### 00-Meta/log.md

```markdown
# 维护日志

## [YYYY-MM-DD] create | LC-Agent-Wiki 初始化
- 创建 LEARNING.md、00-Meta/index.md、00-Meta/log.md、00-Meta/复习队列.base
- 未改动其他笔记
```

之后每次沉淀追加一条：`## [YYYY-MM-DD] ingest | LC0003_无重复字符的最长子串`，下面列出创建或更新了哪些文件。

### 00-Meta/复习队列.base

`file.inFolder` 的路径相对于 Obsidian vault 根目录。下面以 vault 根目录为 `nightmare`、知识库为 `LC-Agent-Wiki` 为例：

```yaml
filters:
  and:
    - file.inFolder("LC-Agent-Wiki/题目")
views:
  - type: table
    name: 今天要复习
    filters:
      and:
        - 'date(next_review) <= today()'
    order:
      - file.name
      - difficulty
      - mastery
      - next_review
      - reviews
    sort:
      - property: next_review
        direction: ASC
  - type: table
    name: 全部题目
    order:
      - file.name
      - difficulty
      - patterns
      - mastery
      - next_review
```

## 题型卡：`题型/P{编号}_{题型名}.md`

```markdown
---
title: "P03 滑动窗口"
type: pattern
pattern_id: P03
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
problems: ["[[LC0003_无重复字符的最长子串]]"]
---

# P03 滑动窗口

> **一句话**：连续区间求最长或最短时，右边界一路扩张，窗口不合法就收缩左边界，每个元素最多进出窗口各一次，复杂度 O(n)。

## 0. 术语速查

| 术语 | 讲解时故事里的叫法 | 一句话意思 |
|---|---|---|
| 扩张窗口 | 右手往右抓一颗 | right++，新元素进入窗口 |

## 1. 识别信号

## 2. 解题四问落在本题型
- 第 3 问（瓶颈）：
- 第 4 问（怎么消除）：

## 3. Java 模板

（与 pattern-catalog.md 一致，可补充注释）

## 4. 模板变化点

| 题目 | 改动的地方 | 为什么 |
|---|---|---|

## 5. 演示

（ASCII 状态图）

[动画：3. 无重复字符的最长子串](../assets/LC0003-动画.html)

## 6. 易错点

## 7. 30 秒面试说法

## 8. 题目清单

| 题目 | 难度 | 掌握度 | 下次复习 |
|---|---|---|---|
| [[LC0003_无重复字符的最长子串]] | Medium | 2 | YYYY-MM-DD |
```

## 单题卡：`题目/LC{四位题号}_{中文名}.md`

```markdown
---
title: "3. 无重复字符的最长子串"
type: problem
site: leetcode-com
id: 3
slug: longest-substring-without-repeating-characters
url: https://leetcode.com/problems/longest-substring-without-repeating-characters/
difficulty: Medium
patterns: ["[[P03_滑动窗口]]"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [interview, algorithm, leetcode]
mastery: 2
next_review: YYYY-MM-DD
interval: 1
reviews: 0
last: { date: YYYY-MM-DD, hints: 0, minutes: 0, first_submit_ac: false }
---

# 3. 无重复字符的最长子串

> **一句话**：[[P03_滑动窗口]]，窗口内不能有重复字符；出现重复就收缩左边界。

## 0. 术语速查

| 术语 | 讲解时故事里的叫法 | 一句话意思 |
|---|---|---|

## 1. 题面

（中文题面）

![[LC0003-example.png]]

> [!note]- 英文原文
> （原文）

## 2. 解题四问
1. 数据规模：n ≤ 5×10⁴ → 允许 O(n log n) 以内
2. 暴力解：
3. 瓶颈：
4. 题型与信号：

## 3. 核心思路

（ASCII 状态图）

[动画](../assets/LC0003-动画.html)

## 4. 和模板的差异

## 5. 标准解法

来源：[题解标题](题解链接) · 作者

（Java 代码块）

### 进阶解法（可选）

## 6. 我的提交

## 7. 复杂度

## 8. 边界与易错点

## 9. 30 秒面试说法

## 10. 练习

| 题目 | 规范答案 | 易错点 |
|---|---|---|

## 11. 相关题
```

**复习字段说明**

- `mastery`：0 未学 / 1 看懂了 / 2 有提示能做出 / 3 独立做出 / 4 限时内一次提交就通过且讲得清
- `interval`：当前复习间隔档，取值 1 / 3 / 7 / 14 / 30（天）
- `next_review`：上次复习日期 + `interval`
- `last`：最近一次练习的情况：日期、提示级数、用时（分钟）、一次提交是否通过
