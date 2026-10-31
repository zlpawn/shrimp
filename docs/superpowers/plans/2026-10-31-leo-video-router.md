# leo-video-router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `lib/skills/leo-video-router`：一个只按场景路由的视频 skill，把需求交给 8 个已验证的项目或 skill，缺失时引导安装，并在没有录音和商业 TTS 时优先用 omnivoice 配音。

**Architecture:** 主体是 Markdown（`SKILL.md` 流程 + `references/` 知识）。唯一的代码是一个 Python 标准库脚本 `scripts/registry.py`，负责「项目在本地哪里」的确定性查找和 `registry.json` 读写，让不同 agent 得到一致结果。`scripts/test_skill.py` 同时测脚本逻辑和文档里必须存在的关键事实。

**Tech Stack:** Markdown、Python 3（只用标准库，`unittest`），bash。

**Spec:** `docs/superpowers/specs/2026-10-31-leo-video-router-design.md`

## Global Constraints

- Router 只路由场景，不选择、不调用任何底层生成引擎；SKILL.md 和 references 里不得出现兜底 skill 的具体命令行。
- Skill 独立可用、不绑定 agent：所有接入知识写进 skill 自己的文件；不依赖任何 agent 的记忆或私有工具。
- 运行期数据目录：`~/.shrimp/skills/leo-video-router/`，registry 文件：`~/.shrimp/skills/leo-video-router/registry.json`。
- 源码类项目默认下载目录：`~/.shrimp/skills/<项目名>`；下载前先问用户要不要指定目录。
- 安装命令只在用户同意后执行；OpenMontage 只能 `git clone`，不能 `npx skills add`。
- omnivoice 接口 `http://127.0.0.1:3900/v1`；健康检查必须带重试（应用启动后约 60 秒才就绪）。
- 不改动任何下游项目代码；文档中的路径示例用占位路径，不写个人机器路径。
- 文案用中文，和 `lib/skills/leo-imagine-router` 风格一致。

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/skills/leo-video-router/scripts/registry.py` | 项目定位（registry → 标准 skill 目录 → 默认下载目录 → 工作区）与登记 |
| `lib/skills/leo-video-router/scripts/test_skill.py` | registry.py 单测 + 文档关键事实与相对链接检查 |
| `lib/skills/leo-video-router/references/routing-matrix.md` | 场景路由矩阵、触发词、重叠区分规则 |
| `lib/skills/leo-video-router/references/projects/<项目>.md` | 8 张接入卡：入口、交接方式、音频入口、注意事项 |
| `lib/skills/leo-video-router/references/audio-omnivoice.md` | 音频决策顺序、omnivoice 接口与实测数据 |
| `lib/skills/leo-video-router/references/install-and-registry.md` | 安装卡片模板、安装命令表、registry 用法 |
| `lib/skills/leo-video-router/references/fallback.md` | 未命中场景时的通用视频提示词规范与兜底执行 |
| `lib/skills/leo-video-router/SKILL.md` | 流程主干与导航卡片 |
| `lib/skills/leo-video-router/README.md` | 人看的介绍与安装方式 |

---

### Task 1: registry.py 项目定位与登记

**Files:**
- Create: `lib/skills/leo-video-router/scripts/registry.py`
- Test: `lib/skills/leo-video-router/scripts/test_skill.py`

**Interfaces:**
- Produces（CLI，供 SKILL.md 和 install-and-registry.md 引用）：
  - `python3 scripts/registry.py locate <项目名>` → 找到时 stdout 输出一行 JSON `{"name", "path", "entry", "via"}`，退出码 0；找不到退出码 1，stdout 输出 `{"name", "found": false}`。
  - `python3 scripts/registry.py register <项目名> <目录> [--source user|install]` → 校验目录含入口文件后写入 registry，退出码 0；校验失败退出码 2。
  - `python3 scripts/registry.py list` → 输出 registry 全部条目 JSON。
- Produces（Python，供测试）：`locate(name, home, cwd) -> dict | None`、`register(name, path, source, home) -> dict`、`PROJECTS: dict`。
- 环境变量 `LEO_VIDEO_ROUTER_HOME` 覆盖数据目录（默认 `~/.shrimp/skills/leo-video-router`），只用于测试。

- [ ] **Step 1: Write the failing test**

Create `lib/skills/leo-video-router/scripts/test_skill.py`:

```python
import json, os, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import registry  # noqa: E402


def touch(p: Path, text="x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        self.cwd = self.tmp / "cwd"
        self.cwd.mkdir(parents=True)
        os.environ["LEO_VIDEO_ROUTER_HOME"] = str(self.tmp / "data")

    def tearDown(self):
        os.environ.pop("LEO_VIDEO_ROUTER_HOME", None)

    def test_unknown_project_raises(self):
        with self.assertRaises(KeyError):
            registry.locate("nope", self.home, self.cwd)

    def test_not_found(self):
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))

    def test_standard_skill_dir_uses_skill_name(self):
        touch(self.home / ".agents/skills/moneyprinterturbo-video/SKILL.md")
        r = registry.locate("MoneyPrinterTurbo", self.home, self.cwd)
        self.assertEqual(r["via"], "skills-dir")
        self.assertTrue(r["entry"].endswith("moneyprinterturbo-video/SKILL.md"))

    def test_default_download_dir_source_project(self):
        touch(self.home / ".shrimp/skills/OpenMontage/AGENT_GUIDE.md")
        r = registry.locate("OpenMontage", self.home, self.cwd)
        self.assertEqual(r["via"], "default-dir")

    def test_openmontage_never_matched_in_skill_dirs(self):
        touch(self.home / ".agents/skills/OpenMontage/AGENT_GUIDE.md")
        self.assertIsNone(registry.locate("OpenMontage", self.home, self.cwd))

    def test_register_then_locate_prefers_registry(self):
        repo = self.tmp / "AI-JJ/lemo-opuscar"
        touch(repo / "plugin/skills/lemo-opuscar/SKILL.md")
        touch(self.home / ".agents/skills/lemo-opuscar/SKILL.md")
        registry.register("lemo-opuscar", repo, "user", self.home)
        r = registry.locate("lemo-opuscar", self.home, self.cwd)
        self.assertEqual(r["via"], "registry")
        self.assertEqual(r["path"], str(repo.resolve()))  # macOS: /var -> /private/var

    def test_register_rejects_dir_without_entry(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        with self.assertRaises(ValueError):
            registry.register("hypit", empty, "user", self.home)

    def test_stale_registry_entry_pruned(self):
        repo = self.tmp / "gone/dashi-animationstyle"
        touch(repo / "SKILL.md")
        registry.register("dashi-animationstyle", repo, "user", self.home)
        (repo / "SKILL.md").unlink()
        self.assertIsNone(registry.locate("dashi-animationstyle", self.home, self.cwd))
        data = json.loads((self.tmp / "data/registry.json").read_text())
        self.assertNotIn("dashi-animationstyle", data["projects"])

    def test_workspace_dir(self):
        touch(self.cwd / "lib/skills/video-shotcraft/SKILL.md")
        r = registry.locate("video-shotcraft", self.home, self.cwd)
        self.assertEqual(r["via"], "workspace")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'registry'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/skills/leo-video-router/scripts/registry.py`:

```python
#!/usr/bin/env python3
"""Locate leo-video-router downstream projects and remember user-chosen directories.

Usage:
  registry.py locate <project>
  registry.py register <project> <dir> [--source user|install]
  registry.py list
"""
import argparse, json, os, sys
from datetime import date
from pathlib import Path

# skill: directory name after `npx skills add` (None = source-only project).
# entries: files that prove a directory is this project, relative to that directory.
PROJECTS = {
    "MoneyPrinterTurbo": {"skill": "moneyprinterturbo-video", "entries": ["SKILL.md", "docs/skill/SKILL.md"]},
    "OpenMontage": {"skill": None, "entries": ["AGENT_GUIDE.md"]},
    "hypit": {"skill": "hypit", "entries": ["SKILL.md", "skills/hypit/SKILL.md"]},
    "lemo-opuscar": {"skill": "lemo-opuscar", "entries": ["SKILL.md", "plugin/skills/lemo-opuscar/SKILL.md"]},
    "xilo-opus-video": {"skill": "xilo-opus-video", "entries": ["SKILL.md", "skills/xilo-opus-video/SKILL.md"]},
    "dashi-animationstyle": {"skill": "dashi-animationstyle", "entries": ["SKILL.md"]},
    "huashu-art-motion": {"skill": "huashu-art-motion", "entries": ["SKILL.md"]},
    "video-shotcraft": {"skill": "video-shotcraft", "entries": ["SKILL.md"]},
}
SKILL_DIRS = [".agents/skills", ".claude/skills", ".codex/skills", ".gemini/config/skills"]
WORKSPACE_DIRS = ["lib/skills", ".agents/skills"]


def data_dir(home: Path) -> Path:
    return Path(os.environ.get("LEO_VIDEO_ROUTER_HOME") or home / ".shrimp/skills/leo-video-router")


def registry_file(home: Path) -> Path:
    return data_dir(home) / "registry.json"


def load(home: Path) -> dict:
    f = registry_file(home)
    if f.exists():
        return json.loads(f.read_text())
    return {"version": 1, "projects": {}}


def save(home: Path, data: dict) -> None:
    f = registry_file(home)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def entry_in(name: str, path: Path):
    for rel in PROJECTS[name]["entries"]:
        if (path / rel).is_file():
            return path / rel
    return None


def candidates(name: str, home: Path, cwd: Path):
    skill = PROJECTS[name]["skill"]
    if skill:
        for d in SKILL_DIRS:
            yield "skills-dir", home / d / skill
    yield "default-dir", home / ".shrimp/skills" / name
    for d in WORKSPACE_DIRS:
        yield "workspace", cwd / d / (skill or name)


def locate(name: str, home: Path, cwd: Path):
    if name not in PROJECTS:
        raise KeyError(name)
    data = load(home)
    rec = data["projects"].get(name)
    if rec:
        entry = entry_in(name, Path(rec["path"]))
        if entry:
            return {"name": name, "path": rec["path"], "entry": str(entry), "via": "registry"}
        del data["projects"][name]  # stale: directory moved or deleted
        save(home, data)
    for via, path in candidates(name, home, cwd):
        entry = entry_in(name, path)
        if entry:
            return {"name": name, "path": str(path), "entry": str(entry), "via": via}
    return None


def register(name: str, path, source: str, home: Path) -> dict:
    if name not in PROJECTS:
        raise KeyError(name)
    path = Path(path).expanduser().resolve()
    if not entry_in(name, path):
        raise ValueError(f"{path} has none of {PROJECTS[name]['entries']}")
    data = load(home)
    data["projects"][name] = {"path": str(path), "source": source, "added": date.today().isoformat()}
    save(home, data)
    return data["projects"][name]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="leo-video-router project registry")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("locate").add_argument("name", choices=sorted(PROJECTS))
    r = sub.add_parser("register")
    r.add_argument("name", choices=sorted(PROJECTS))
    r.add_argument("path")
    r.add_argument("--source", choices=["user", "install"], default="user")
    sub.add_parser("list")
    a = p.parse_args(argv)
    home, cwd = Path.home(), Path.cwd()
    if a.cmd == "locate":
        hit = locate(a.name, home, cwd)
        print(json.dumps(hit or {"name": a.name, "found": False}, ensure_ascii=False))
        return 0 if hit else 1
    if a.cmd == "register":
        try:
            print(json.dumps(register(a.name, a.path, a.source, home), ensure_ascii=False))
        except ValueError as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            return 2
        return 0
    print(json.dumps(load(home), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: `Ran 9 tests ... OK`

- [ ] **Step 5: Smoke-test the CLI against a throwaway data dir**

Run:
```bash
cd lib/skills/leo-video-router
LEO_VIDEO_ROUTER_HOME=$(mktemp -d) python3 scripts/registry.py locate hypit; echo "exit=$?"
```
Expected: 一行 JSON（找到时 `"via"` 为 `skills-dir` / `default-dir` / `workspace`；没装时 `{"name": "hypit", "found": false}` 且 `exit=1`）。

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-video-router/scripts
git commit -m "feat(leo-video-router): add project registry locate/register script"
```

---

### Task 2: routing-matrix.md 场景路由矩阵

**Files:**
- Create: `lib/skills/leo-video-router/references/routing-matrix.md`
- Modify: `lib/skills/leo-video-router/scripts/test_skill.py`（追加文档检查）

**Interfaces:**
- Consumes: Task 1 的 `PROJECTS` 键名（8 个项目名必须与之完全一致）。
- Produces: 矩阵中每个项目链接到 `projects/<项目名>.md`（Task 3 创建）。

- [ ] **Step 1: Write the failing test**

在 `test_skill.py` 的 `if __name__` 之前追加：

```python
SKILL = HERE.parent


class DocsTest(unittest.TestCase):
    def read(self, rel):
        return (SKILL / rel).read_text()

    def test_matrix_lists_every_project_and_drops_mg_styles(self):
        text = self.read("references/routing-matrix.md")
        for name in registry.PROJECTS:
            self.assertIn(f"projects/{name}.md", text, name)
        self.assertIn("mg-styles-15", text)  # recorded as removed, with reason

    def test_relative_links_resolve(self):
        import re
        for md in SKILL.rglob("*.md"):
            for link in re.findall(r"\]\(([^)#:]+\.md)", md.read_text()):
                self.assertTrue((md.parent / link).exists(), f"{md.relative_to(SKILL)} -> {link}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest`
Expected: ERROR `FileNotFoundError: ... references/routing-matrix.md`

- [ ] **Step 3: Write routing-matrix.md**

内容必须包含：
1. 标题 `# 场景路由矩阵`，开头一句：Router 只决定交给谁，执行方式看各项目接入卡。
2. 表格，列为「场景 | 触发词 | 项目 | 画面来源 | 音频类型 | 接入卡」，8 行，内容逐行取自 spec 第 4 节表格；触发词：
   - MoneyPrinterTurbo：批量、快速出一条、信息流、混剪、矩阵号、给个主题就行、抖音/小红书/TikTok 竖屏
   - OpenMontage：剪辑我的素材、长视频切片、播客转视频、翻译配音、多语字幕、录屏演示、纪录片混剪、预告片、数字人口播
   - hypit：AI 人物出镜、UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员、复刻这条社媒视频
   - lemo-opuscar：点名库里的风格（油画厚涂、浮世绘、卫星简报、产品拆解……）、有哪些风格、存成我的风格
   - xilo-opus-video：用代码做视频、先给几个方案、按我的音乐卡点、绿幕人物、Manim、只要提示词
   - dashi-animationstyle：把这段口播做成动画、手绘笔记/扁平流程图/复古报刊等 7 套风格、拖进剪映
   - huashu-art-motion：梵高/莫奈等具名艺术家、名画穿越、艺术史、Vox/3b1b/Kurzgesagt/白板/财经解说
   - video-shotcraft：产品宣传片、给我的网站/App 做片、Ink Press、给视频配音效
   - 音频类型列取值：`内生` / `内生（可外配）` / `可选` / `必须先有口播` / `无旁白`
   - 接入卡列：`[接入卡](projects/<项目名>.md)`
3. `## 重叠项目的区分规则`：逐条照抄 spec 第 4 节 6 条规则。
4. `## 歧义处理`：命中两个以上项目时，给出最多 2 个候选和一句话区别，让用户选。
5. `## 已移除`：`mg-styles-15`——只有 15 份提示词，不是 skill，固定 10 秒；风格被 lemo-opuscar 覆盖，自由创作被 xilo-opus-video 覆盖。

- [ ] **Step 4: Run test (link check expected to fail until Task 3)**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest.test_matrix_lists_every_project_and_drops_mg_styles`
Expected: PASS（`test_relative_links_resolve` 会在 Task 3 完成后才通过）

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-video-router/references/routing-matrix.md lib/skills/leo-video-router/scripts/test_skill.py
git commit -m "feat(leo-video-router): add scene routing matrix"
```

---

### Task 3: 8 张项目接入卡

**Files:**
- Create: `lib/skills/leo-video-router/references/projects/MoneyPrinterTurbo.md`
- Create: `lib/skills/leo-video-router/references/projects/OpenMontage.md`
- Create: `lib/skills/leo-video-router/references/projects/hypit.md`
- Create: `lib/skills/leo-video-router/references/projects/lemo-opuscar.md`
- Create: `lib/skills/leo-video-router/references/projects/xilo-opus-video.md`
- Create: `lib/skills/leo-video-router/references/projects/dashi-animationstyle.md`
- Create: `lib/skills/leo-video-router/references/projects/huashu-art-motion.md`
- Create: `lib/skills/leo-video-router/references/projects/video-shotcraft.md`
- Modify: `lib/skills/leo-video-router/scripts/test_skill.py`

**Interfaces:**
- Consumes: Task 1 `PROJECTS`（文件名 = 项目名）。
- Produces: 每张卡固定 6 节，SKILL.md（Task 6）按节名引用：`## 适合` `## 不适合` `## 安装` `## 交接` `## 音频` `## 注意`。

- [ ] **Step 1: Write the failing test**

在 `DocsTest` 里追加：

```python
    CARD_SECTIONS = ["## 适合", "## 不适合", "## 安装", "## 交接", "## 音频", "## 注意"]
    CARD_FACTS = {
        "MoneyPrinterTurbo": ["npx skills add harry0703/MoneyPrinterTurbo -g", "--root", "--custom-audio-file", "--video-script"],
        "OpenMontage": ["git clone https://github.com/calesthio/OpenMontage.git", "AGENT_GUIDE.md", "OPENAI_BASE_URL=http://127.0.0.1:3900/v1", "tts-1", "不要写进"],
        "hypit": ["npx skills add hypit-ai/hypit -g"],
        "lemo-opuscar": ["npx skills add lemomo-ai/lemo-opuscar -g", "LEMO_OPUSCAR_HOME"],
        "xilo-opus-video": ["npx skills add Kianzzz/xilo-opus-video -g", "绿幕"],
        "dashi-animationstyle": ["npx skills add chuspeeism/dashi-animationstyle -g", "--audio"],
        "huashu-art-motion": ["npx skills add alchaincyf/huashu-art-motion -g", "use-audio", "重试"],
        "video-shotcraft": ["npx skills add Vincentwei1021/video-shotcraft -g"],
    }

    def test_project_cards(self):
        for name, facts in self.CARD_FACTS.items():
            text = self.read(f"references/projects/{name}.md")
            for s in self.CARD_SECTIONS + facts:
                self.assertIn(s, text, f"{name}: missing {s!r}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest.test_project_cards`
Expected: ERROR `FileNotFoundError: ... projects/MoneyPrinterTurbo.md`

- [ ] **Step 3: Write the 8 cards**

每张卡结构：`# <项目名>`，一行仓库地址，然后 6 节。各卡必须写入的内容：

**MoneyPrinterTurbo.md**（仓库 `https://github.com/harry0703/MoneyPrinterTurbo`）
- 适合：主题或文案 → 旁白 + 素材混剪 + 字幕 + BGM 的竖屏信息流短视频；`--video-count` 一次多条、`--batch-file` 批量；可一键发布 TikTok / Instagram / YouTube Shorts。
- 不适合：要镜头设计、风格控制、精品画面（画面靠关键词匹配素材，和文案对应松）。
- 安装：`npx skills add harry0703/MoneyPrinterTurbo -g`，安装后的 skill 名 `moneyprinterturbo-video`；首次运行 helper 下载源码到 `~/MoneyPrinterTurbo`，用 `--root ~/.shrimp/skills/MoneyPrinterTurbo` 改到默认目录。
- 交接：按该 skill 的 SKILL.md 执行 `uv run --no-project --python 3.11 python mpt_agent.py --subject "<主题>"`（工作目录为 skill 目录，超时至少 20 分钟），额外 CLI 参数放在 `--` 之后；默认中文、9:16、Pexels、Edge TTS。
- 音频：内生。用 omnivoice 时：先定稿文案，omnivoice 生成配音，传 `-- --video-script "<文案>" --custom-audio-file <wav>`。自定义音频时字幕如何生成未验证，首次使用要检查成片字幕。
- 注意：它的 skill 规定「安装和生成都不问确认」，Router 必须在交接前拿到用户对安装的同意；Seedance、MiniMax 等付费素材源每次需用户显式确认对应 `--confirm-*-charge`；只在缺 API Key 时它会退出码 10 请求凭证。

**OpenMontage.md**（仓库 `https://github.com/calesthio/OpenMontage`）
- 适合：已有素材的加工——真人口播剪辑（talking-head）、长视频切短（clip-factory）、播客转视频（podcast-repurpose）、多语字幕与配音（localization-dub）、录屏演示（screen-demo）、档案素材纪录片（documentary-montage）、预告片（cinematic）、主题讲解（animated-explainer / animation）、数字人口播（avatar-spokesperson）；参考视频复刻（混剪 / 预告 / 讲解类）。
- 不适合：需要 AI 生成人物表演的社媒视频（交给 hypit）；只想快速批量出片（交给 MoneyPrinterTurbo）。
- 安装：源码项目，`git clone https://github.com/calesthio/OpenMontage.git <目录>`，默认目录 `~/.shrimp/skills/OpenMontage`；**不要用 `npx skills add`**：它会找到内部 `.agents/skills/` 下 89 个工具类 skill，不是入口。依赖：Python 3.10+、FFmpeg，按其 README 安装。
- 交接：在项目根目录工作，先读 `AGENT_GUIDE.md`（`AGENTS.md` 只指向它），按 Rule Zero 走 pipeline：选 pipeline → 读 `pipeline_defs/<pipeline>.yaml` → preflight → 逐阶段读 director skill 后执行。
- 音频：内生（ElevenLabs、Piper 等）。用 omnivoice 时：只在调用 TTS 的那一条命令前加 `OPENAI_API_KEY=none OPENAI_BASE_URL=http://127.0.0.1:3900/v1`，显式调用 `openai_tts`，参数 `model: tts-1`（或 `tts-1-hd`）、`response_format: wav`、`voice` 用 omnivoice 音色 ID。实测 2026-10-31 成功生成 12.48 秒 wav。
- 注意：这两个变量**不要写进** `.env`——同一进程里 `openai_image` 会被发到 omnivoice（返回 405），preflight 还会把 `openai_image`、`sora_video` 误标为可用；不传 model 时默认 `gpt-4o-mini-tts`，omnivoice 返回 400。机器设有 SOCKS 代理时 Python 环境需要 `socksio`。

**hypit.md**（仓库 `https://github.com/hypit-ai/hypit`）
- 适合：生成优先的社媒视频——UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员 + MG、旁白带货；复刻社媒真人表演类参考视频；以词为锚的时间轴，Studio 里可视化修改。
- 不适合：只加工已有素材（交给 OpenMontage）；不想付费调用生成模型。
- 安装：`npx skills add hypit-ai/hypit -g`；首次使用时它会检查并协助安装 Hypit 可执行程序。
- 交接：按其 SKILL.md 执行；生成模型通过 HypiHub 或用户自己的 API Key 接入，付费前它会和用户确认预算。
- 音频：内生（ElevenLabs、FishAudio、MiMo，支持音色克隆）。用户提供的录音可作为表演音轨或克隆参考；omnivoice 生成的音频按「用户提供的录音」交给它。AI 人物开口说话的镜头不替换音频。
- 注意：需要词级时间时它用 WhisperX。

**lemo-opuscar.md**（仓库 `https://github.com/lemomo-ai/lemo-opuscar`）
- 适合：在 66 种风格里点名做代码短片（含「剪辑与纪实」「实证影像」：档案影像、卫星图、激光点云、CAD 拆解）；没选风格时帮用户挑；改风格或从空白做自己的风格并保存。
- 不适合：剪辑、裁剪、转码用户已有视频。
- 安装：`npx skills add lemomo-ai/lemo-opuscar -g`（也可 `claude plugin install`，但 `npx skills` 对所有 agent 通用）；首次运行 `setup.sh` 把风格库 clone 到 `~/lemo-opuscar`，设 `LEMO_OPUSCAR_HOME=~/.shrimp/skills/lemo-opuscar` 改到默认目录。
- 交接：按其 SKILL.md：`setup.sh` 取库 → `setup.sh deps` 装依赖 → 读 `$LIB/AGENTS.md`，项目目录建在用户发起时所在文件夹。
- 音频：内生，配乐和音效由代码生成；配音默认中文 edge-tts、英文 Kokoro。`TECHNIQUE.md` §4 规定用户带录音就用录音，omnivoice 配音按录音交给它。
- 注意：SKILL 里用到 Claude 的 `AskUserQuestion`，其他 agent 改为普通提问；作者说明风格按 Opus 5.5 调校，其他模型效果不保证。

**xilo-opus-video.md**（仓库 `https://github.com/Kianzzz/xilo-opus-video`）
- 适合：不限风格的代码视频；先出三个方案和预览再做；按用户给的音乐测节拍卡点；给视频模型生成的绿幕人物搭代码场景；Manim / Remotion / HyperFrames；只要 `brief.md` 提示词。
- 不适合：写实画面（需要视频模型）；在剪映、PR、AE 里剪辑现成素材；给已有视频加字幕。产品宣传片优先交给 video-shotcraft。
- 安装：`npx skills add Kianzzz/xilo-opus-video -g`。
- 交接：按其 SKILL.md 六步：`check_env.py` → 问清需求 → 三个方案 → 预览 → `brief.md` → 制作与验收；工作目录 `opus-video/<slug>/`。
- 音频：可选，默认代码合成配乐、不配音；配音接 edge-tts、Kokoro 或用户自己的语音，omnivoice 配音按用户语音交给它。
- 注意：绿幕人物可先用环境里的视频生成 skill 生成纯绿幕片段，再交给它抠像合成。

**dashi-animationstyle.md**（仓库 `https://github.com/chuspeeism/dashi-animationstyle`）
- 适合：15–60 秒中文知识口播 → 1920×1080 风格讲解动画，带字幕，能直接拖进剪映；7 套风格（扁平流程图、手绘笔记、复古报刊、复古剪纸、超现实拼贴、立体卡通、黑底科技）；照参考图做新风格；用文字描述出 2–3 个方向。
- 不适合：超过 60 秒（要分段）；配乐、音效、真人画面穿插（回剪映做）。
- 安装：`npx skills add chuspeeism/dashi-animationstyle -g`；环境 macOS、Node 22+、ffmpeg、Google Chrome，whisper-cpp 可选。
- 交接：按其 SKILL.md 用法一：`新建作品.mjs <作品目录> --style <风格> --audio <口播文件> [--script <稿子.txt>]` → `字幕.mjs` → 分镜确认 → 3 张静帧确认 → 出片。
- 音频：**必须先有口播**，`--audio` 必填。用户没有录音时：omnivoice 生成 wav 作为 `--audio`，同时把文案存为稿子传 `--script`。
- 注意：一次约 30 分钟到 1 小时，中间停两次请用户确认。

**huashu-art-motion.md**（仓库 `https://github.com/alchaincyf/huashu-art-motion`）
- 适合：具名艺术家笔法（梵高、莫奈等）；名画穿越、艺术史速通、长卷换风格；YouTube 解说语法（Vox、3b1b、Kurzgesagt、白板、财经图表）片段；拆解复刻动画。
- 不适合：口播转写和逐字时间轴（它交给外部管线；完整中文口播讲解交给 dashi）；媒介或类型风格优先看 lemo-opuscar。
- 安装：`npx skills add alchaincyf/huashu-art-motion -g`；仓库约 77 MB，2026-10-31 首次 clone 因网络中断失败，失败时重试一次。
- 交接：按其 SKILL.md 先分档，再按任务类型读对应 references；交付前跑 `qa.py` 和 `deliver.py`。
- 音频：可选。已有录音：`python "$S/scripts/capabilities.py" use-audio --audio <录音> --out <项目>/音频/口播.wav`；omnivoice 生成的 wav 同样走 `use-audio`。它自带的声音路径是 macOS `say` 和火山复刻。
- 注意：无声动画不启动语音配置。

**video-shotcraft.md**（仓库 `https://github.com/Vincentwei1021/video-shotcraft`）
- 适合：用前端项目或网页的真实截图做电影感产品宣传片；三种模式（Ink Press 模板、自主自由创作、共同创作）；单镜头动效；导出剪映工程；给已有视频或镜头找、加、对齐音效。
- 不适合：需要旁白的口播视频（作者另有 video-talkcraft，未纳入）。
- 安装：`npx skills add Vincentwei1021/video-shotcraft -g`。
- 交接：按其 SKILL.md：先判断任务范围，未选模式时先做只读产品检查，再让用户选三种模式之一。
- 音频：无旁白，BGM 和音效由它处理；不需要 omnivoice。
- 注意：Gallery 地址 `https://vincentwei1021.github.io/video-shotcraft/`，用户可在里面挑镜头卡。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: 全部 OK（含 `test_relative_links_resolve`）

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-video-router/references/projects lib/skills/leo-video-router/scripts/test_skill.py
git commit -m "feat(leo-video-router): add project integration cards"
```

---

### Task 4: audio-omnivoice.md 音频决策

**Files:**
- Create: `lib/skills/leo-video-router/references/audio-omnivoice.md`
- Modify: `lib/skills/leo-video-router/scripts/test_skill.py`

**Interfaces:**
- Consumes: Task 3 接入卡的 `## 音频` 节（本文件链接过去，不重复各项目细节）。
- Produces: SKILL.md 第 5 步引用本文件。

- [ ] **Step 1: Write the failing test**

在 `DocsTest` 里追加：

```python
    def test_audio_doc(self):
        text = self.read("references/audio-omnivoice.md")
        for s in ["http://127.0.0.1:3900/v1", "/v1/audio/speech", "/v1/audio/voices",
                  "--retry", "3902", "asr_model_missing", "口型"]:
            self.assertIn(s, text, s)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest.test_audio_doc`
Expected: ERROR `FileNotFoundError`

- [ ] **Step 3: Write audio-omnivoice.md**

内容：
1. `## 为什么优先 omnivoice`：spec 第 5 节「背景」原文（各项目免费 TTS 的情况 + 2026-10-31 对比试听结论）。
2. `## 决策顺序`：spec 第 5 节 4 步原文 + 「例外」段落（含「口型对不上」）。
3. `## 各项目怎么接`：一张表，项目名链接到 `projects/<项目名>.md#音频`，一句话说明入口（取自 spec 第 5 节表格）。
4. `## omnivoice 接口`：
   - 健康检查（带重试，最多约 90 秒）：
     ```bash
     curl -s -m 90 --retry 15 --retry-connrefused --retry-delay 5 http://127.0.0.1:3900/health
     ```
     正常返回 `{"status":"ok",...}`。
   - 列音色：`curl -s http://127.0.0.1:3900/v1/audio/voices`，优先用用户的克隆音色 `voice_id`，没有就用 `alloy` 等 OpenAI 别名（映射到当前引擎默认音色）。
   - 生成：
     ```bash
     curl -s http://127.0.0.1:3900/v1/audio/speech \
       -H "Content-Type: application/json" \
       -d '{"model":"tts-1","voice":"<voice_id>","input":"<文案>","response_format":"wav"}' \
       -o narration.wav
     ```
   - 说明：3902 端口是 VoiceStudio 控制服务，不是语音引擎；应用启动后约 60 秒 3900 才响应。不可用时提示用户启动 VoiceStudio，不要擅自换云端服务。
5. `## 实测数据（2026-10-31，Apple Silicon MPS）`：12.5 秒中文音频冷启动 40 秒、热启动 22 秒；输出 24 kHz 单声道 16-bit wav；语音转文字需先在 VoiceStudio 下载 Whisper 模型（约 3 GB），否则返回 `asr_model_missing`，字幕交给各项目自己的 whisper。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: 全部 OK

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-video-router/references/audio-omnivoice.md lib/skills/leo-video-router/scripts/test_skill.py
git commit -m "feat(leo-video-router): add omnivoice audio decision guide"
```

---

### Task 5: install-and-registry.md 与 fallback.md

**Files:**
- Create: `lib/skills/leo-video-router/references/install-and-registry.md`
- Create: `lib/skills/leo-video-router/references/fallback.md`
- Modify: `lib/skills/leo-video-router/scripts/test_skill.py`

**Interfaces:**
- Consumes: Task 1 CLI（`registry.py locate|register|list`）；Task 3 接入卡的 `## 安装` 节。
- Produces: SKILL.md 第 3、4、7 步引用这两个文件。

- [ ] **Step 1: Write the failing test**

在 `DocsTest` 里追加：

```python
    def test_install_doc(self):
        text = self.read("references/install-and-registry.md")
        for s in ["registry.py locate", "registry.py register", "~/.shrimp/skills/<项目名>",
                  "~/.shrimp/skills/leo-video-router/registry.json", "用户同意"]:
            self.assertIn(s, text, s)

    def test_fallback_doc_names_no_engine_commands(self):
        text = self.read("references/fallback.md")
        self.assertIn("让用户选", text)
        for s in ["leo_huoshan_imagine.mjs", "grok_imagine.mjs", "client.py"]:
            self.assertNotIn(s, text, f"fallback must not hard-code {s}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest.test_install_doc DocsTest.test_fallback_doc_names_no_engine_commands`
Expected: ERROR `FileNotFoundError`

- [ ] **Step 3: Write install-and-registry.md**

内容：
1. `## 探测`：先运行 `python3 <skill 目录>/scripts/registry.py locate <项目名>`；它按顺序查 registry → `~/.agents/skills` / `~/.claude/skills` / `~/.codex/skills` / `~/.gemini/config/skills` → `~/.shrimp/skills/<项目名>` → 当前工作区 `./lib/skills`、`./.agents/skills`。另外 agent 上下文里已列出的可用 skill 也算已安装。退出码 0 = 找到（读输出里的 `entry`），1 = 没找到。
2. `## 安装卡片模板`（代码块，和 imagine-router 的引导模板同风格）：
   ```text
   💡 场景推荐：您的需求适合交给 【<项目名>】（<一句话特性>）。
   当前环境未检测到它：
   * 开源地址：<仓库地址>
   * 安装命令：<npx skills add ... -g 或 git clone ... <目录>>
   * 源码目录：默认 ~/.shrimp/skills/<项目名>，也可以指定其他目录
   请问是否需要我帮您安装？
   * 回复「安装」：我来执行上面的命令，完成后直接接着做
   * 回复「已经下载在 <目录>」：我登记这个目录，不重复下载
   * 回复「直接出片」：改用通用兜底方式
   ```
3. `## 执行规则`：只在用户同意后执行；skill 类用 `npx skills add <repo> -g`，源码类用 `git clone`（OpenMontage 只能 clone）；clone 失败重试一次；装好后 `registry.py register <项目名> <目录> --source install`；用户给出已有目录时 `registry.py register <项目名> <目录> --source user`，退出码 2 表示目录里没有入口文件，告诉用户并让其确认路径；依赖安装按项目自己的文档进行。
4. `## 安装命令表`：spec 6.2 的表格（8 行，含验证情况列）。
5. `## registry.json`：路径 `~/.shrimp/skills/leo-video-router/registry.json`，格式示例用 `/path/to/OpenMontage` 占位，字段说明（`path`、`source: user|install`、`added`），失效条目由 `locate` 自动删除。

- [ ] **Step 4: Write fallback.md**

内容：
1. `## 何时兜底`：未命中任何场景，或用户拒绝安装推荐项目并选「直接出片」。
2. `## 通用视频提示词规范`：7 个槽位——主体、场景、动作、运镜、风格、时长与画幅、声音；每个槽位一句写法要求和一个示例（如运镜：「镜头缓慢推近到积水倒影特写」）；多镜头用「镜头1：…；镜头2：…」；结尾声明「无字幕无水印」等约束。
3. `## 执行`：从 agent 上下文的可用 skill 中找能生成视频的 skill，按它自己的文档传入提示词、参考图、时长、画幅；有多个时列出来让用户选；一个都没有就只交付提示词。不在本文件写任何具体 skill 的命令行。
4. `## 音频`：兜底生成的视频需要旁白时同样按 [audio-omnivoice.md](audio-omnivoice.md) 决策。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: 全部 OK

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-video-router/references/install-and-registry.md lib/skills/leo-video-router/references/fallback.md lib/skills/leo-video-router/scripts/test_skill.py
git commit -m "feat(leo-video-router): add install/registry guide and fallback spec"
```

---

### Task 6: SKILL.md 与 README.md

**Files:**
- Create: `lib/skills/leo-video-router/SKILL.md`
- Create: `lib/skills/leo-video-router/README.md`
- Modify: `lib/skills/leo-video-router/scripts/test_skill.py`

**Interfaces:**
- Consumes: Task 1–5 所有文件；接入卡节名 `## 交接` `## 音频`；CLI `registry.py locate`。

- [ ] **Step 1: Write the failing test**

在 `DocsTest` 里追加：

```python
    def test_skill_md(self):
        text = self.read("SKILL.md")
        self.assertTrue(text.startswith("---\nname: leo-video-router\ndescription: "))
        for s in ["references/routing-matrix.md", "references/install-and-registry.md",
                  "references/audio-omnivoice.md", "references/fallback.md",
                  "scripts/registry.py locate", "不选择、不调用任何底层生成引擎"]:
            self.assertIn(s, text, s)
        self.assertLess(len(text.splitlines()), 200, "keep SKILL.md lean; details live in references/")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py DocsTest.test_skill_md`
Expected: ERROR `FileNotFoundError`

- [ ] **Step 3: Write SKILL.md**

结构：
1. Frontmatter：
   ```yaml
   ---
   name: leo-video-router
   description: Use when the user wants to make a video (短视频、宣传片、讲解动画、口播动画、风格短片、AI 人物出镜、素材剪辑、批量出片) or asks what video scenes are supported. Routes the request by scene to the best open-source project or skill (MoneyPrinterTurbo, OpenMontage, hypit, lemo-opuscar, xilo-opus-video, dashi-animationstyle, huashu-art-motion, video-shotcraft), detects whether it is installed, guides user-approved installation, prefers local omnivoice narration when no recording or paid TTS is available, and falls back to any available video-generation skill.
   ---
   ```
2. `# Leo Video Router（视频场景路由）` + `## 核心定位`：只回答交给谁；**不选择、不调用任何底层生成引擎**；skill 独立可用，所有知识在 `references/`。
3. `## 工作流`：mermaid 流程图 + 7 步，每步一两句并链接：
   1) 场景导航（触发条件同 imagine-router：只调用 skill、问能做什么、给了素材没说方向）→ 展示下面的导航卡片；
   2) 意图分类 → [references/routing-matrix.md](references/routing-matrix.md)；
   3) 探测 → `python3 <skill 目录>/scripts/registry.py locate <项目名>`；
   4) 安装引导 → [references/install-and-registry.md](references/install-and-registry.md)；
   5) 音频决策 → [references/audio-omnivoice.md](references/audio-omnivoice.md)；
   6) 交接 → 读 `references/projects/<项目名>.md` 的「交接」「音频」「注意」三节和项目自己的入口文档；
   7) 交付 → 成片路径、用了哪个项目、音频来源；未命中或用户拒绝安装 → [references/fallback.md](references/fallback.md)。
4. `## 场景导航卡片`：代码块模板，按 8 个场景分组列出（编号、场景名、项目名、一句话适合什么），末尾一行「也可以直接描述您想做的视频」。
5. `## 铁律`：安装只在用户同意后执行；不改下游代码；付费调用由下游按自己的规则确认，Router 不替用户同意；交付时说明音频来源。

- [ ] **Step 4: Write README.md**

结构参照 `lib/skills/leo-imagine-router/README.md`：标题、一句话定位、核心特性（场景路由、与引擎解耦、JIT 安装与目录记忆、omnivoice 优先、兜底）、8 个场景表（场景 | 项目）、安装到 `~/.agents/skills`（`cp -r "lib/skills/leo-video-router" ~/.agents/skills/` 与 Windows PowerShell `Copy-Item` 两条）、运行期数据目录说明、License MIT。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd lib/skills/leo-video-router && python3 scripts/test_skill.py`
Expected: 全部 OK

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-video-router/SKILL.md lib/skills/leo-video-router/README.md lib/skills/leo-video-router/scripts/test_skill.py
git commit -m "feat(leo-video-router): add SKILL.md workflow and README"
```

---

### Task 7: 安装到本机并验收

**Files:**
- 无仓库改动（若验收发现文档问题，修改对应文件并单独提交）

- [ ] **Step 1: 同步到中央 skill 目录**

Run:
```bash
cp -r lib/skills/leo-video-router ~/.agents/skills/
diff -rq lib/skills/leo-video-router ~/.agents/skills/leo-video-router && echo synced
```
Expected: `synced`

- [ ] **Step 2: 登记用户已有的项目目录（先征得用户同意）**

用户已把 8 个项目 clone 在 `~/project/AI-JJ`。征得同意后运行：
```bash
cd ~/.agents/skills/leo-video-router
for p in MoneyPrinterTurbo OpenMontage hypit lemo-opuscar xilo-opus-video dashi-animationstyle huashu-art-motion video-shotcraft; do
  python3 scripts/registry.py register "$p" "$HOME/project/AI-JJ/$p" --source user
done
python3 scripts/registry.py locate dashi-animationstyle
```
Expected: 8 行登记 JSON；`locate` 输出 `"via": "registry"`。

- [ ] **Step 3: omnivoice 健康检查**

Run: `curl -s -m 90 --retry 15 --retry-connrefused --retry-delay 5 http://127.0.0.1:3900/health`
Expected: `{"status":"ok",...}`；不通时记录并提示用户启动 VoiceStudio。

- [ ] **Step 4: 路由走查**

逐条对照 `references/routing-matrix.md` 判断应交给谁，结果写进对话给用户确认：
1. 「给个主题，批量出 3 条抖音短视频」 → MoneyPrinterTurbo
2. 「把这段口播做成手绘笔记风格动画」 → dashi-animationstyle
3. 「用梵高风格做一段 30 秒动画」 → huashu-art-motion
4. 「给我的产品网站做支宣传片」 → video-shotcraft
5. 「做一段 AI 生成的街头采访」 → hypit
6. 「把这个 1 小时播客切成 5 条短视频」 → OpenMontage
7. 「我想做个视频」 → 展示场景导航卡片

任何一条判断不清，就修改 routing-matrix.md 的触发词或区分规则，重跑 `python3 scripts/test_skill.py`，单独提交。

- [ ] **Step 5: 端到端试跑一条（征得用户同意后）**

用例 2：用 omnivoice 为一段 20 秒中文文案生成 wav，交给 dashi-animationstyle 出片（约 30 分钟，中间有两次确认）。只在用户同意后执行。
