# 公司 PPT 模板扩页填充兜底指南

## 何时使用

- **③ Z2 公司 `.pptx` 模板填充**：用户提供了公司标准 `.pptx` 模板（最常见为“封面页 / 内容母版页 / 结束感谢页”3 页结构，或含多套内容版式页），且首选技能 `ppt-master` 未安装、用户明确拒绝安装时。
- 产物完整保留公司母版、背景、页眉页脚、Logo 与文本框原有字号颜色，输出原生可编辑 `.pptx`（`✅` 可在 PowerPoint / WPS 中继续编辑）。

## 局限声明

> **动手执行前必须事先告知用户**：本兜底方案效果明显弱于 ppt-master——脚本仅能克隆模板中已有的示例页并替换现有文本槽位或占位符中的文字，无法根据内容语义自动重排版式、动态增删卡片网格，也无法自动绘制复杂的信息图、SVG 插画或原生数据图表。若用户追求多版式智能编排与图文并茂效果，应建议先安装 `ppt-master`。

## 流程

1. **探测模板槽位**：在临时或产物目录保存下方 `fill_template.py`，运行以下命令查看模板每一页的页码索引及各文本槽位（按从上到下、从左到右排序）的序号与示例文字：
   ```bash
   uv run fill_template.py inspect <template.pptx>
   ```
2. **编写结构化大纲 `deck.json`**：根据 `inspect` 输出确认封面页、内容页、结束页的页码（`slots.cover` / `slots.content` / `slots.closing`），按 `outline-architect.md` 与 `cjk-text-fit.md` 控制每页要点字数与行数（避免超出原模板文本框高度），生成 `deck.json`。
3. **扩页并填充生成产物**：
   ```bash
   uv run fill_template.py build <template.pptx> deck.json presentation.pptx
   ```

## 脚本骨架（PEP 723）

将以下含 PEP 723 内联依赖声明的脚本完整保存为产物目录下的 `fill_template.py`（通过 `uv run` 自动在隔离缓存环境中拉取 `python-pptx`，不污染全局或仓库环境）：

```python
#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-pptx>=1.0.0"]
# ///
"""基于公司 3 页模板（首页 / 内容页 / 感谢页）扩页填充，保留母版、logo 与版式。

用法：
  uv run fill_template.py inspect <template.pptx>
  uv run fill_template.py build <template.pptx> <deck.json> <out.pptx>
"""
import copy
import json
import sys

from pptx import Presentation


def text_slots(slide):
    """模板页中带文字的形状，按从上到下、从左到右排序。"""
    shapes = [s for s in slide.shapes if s.has_text_frame and s.text_frame.text.strip()]
    return sorted(shapes, key=lambda s: (s.top or 0, s.left or 0))


def inspect(path):
    prs = Presentation(path)
    for i, slide in enumerate(prs.slides):
        print(f"[slide {i}] layout={slide.slide_layout.name!r}")
        for j, s in enumerate(text_slots(slide)):
            print(f"  slot {j}: name={s.name!r} top={s.top} left={s.left} text={s.text_frame.text[:40]!r}")


def duplicate_slide(prs, index):
    """复制第 index 页到末尾：同一版式 + 深拷贝全部形状 + 安全重映射资源关系。"""
    src = prs.slides[index]
    dst = prs.slides.add_slide(src.slide_layout)
    for shp in list(dst.shapes):
        shp._element.getparent().remove(shp._element)
    rid_map = {}
    for rId, rel in src.part.rels.items():
        if "slideLayout" in rel.reltype or "notesSlide" in rel.reltype:
            continue
        rid_map[rId] = (
            dst.part.rels.get_or_add_ext_rel(rel.reltype, rel._target)
            if rel.is_external
            else dst.part.relate_to(rel._target, rel.reltype)
        )
    for shp in src.shapes:
        el = copy.deepcopy(shp._element)
        for node in el.iter():
            for k, v in list(node.attrib.items()):
                if v in rid_map:
                    node.attrib[k] = rid_map[v]
        dst.shapes._spTree.append(el)
    return dst


def move_slide(prs, old_index, new_index):
    lst = prs.slides._sldIdLst
    el = list(lst)[old_index]
    lst.remove(el)
    lst.insert(new_index, el)


def set_text(shape, lines):
    """替换文字但保留首段首个 run 的字体、字号、颜色。"""
    lines = [lines] if isinstance(lines, str) else list(lines)
    tf = shape.text_frame
    proto = copy.deepcopy(tf.paragraphs[0]._p)
    for p in list(tf.paragraphs):
        p._p.getparent().remove(p._p)
    for _ in lines:
        tf._txBody.append(copy.deepcopy(proto))
    for para, line in zip(tf.paragraphs, lines):
        runs = para.runs
        if runs:
            runs[0].text = line
            for r in runs[1:]:
                r._r.getparent().remove(r._r)
        else:
            para.text = line


def build(template, deck_path, out):
    with open(deck_path, encoding="utf-8-sig") as f:
        deck = json.load(f)
    m = deck.get("slots", {"cover": 0, "content": 1, "closing": 2})
    prs = Presentation(template)
    pages = deck["pages"]

    copies = [duplicate_slide(prs, m["content"]) for _ in pages[1:]]
    cover = text_slots(prs.slides[m["cover"]])
    set_text(cover[0], deck["cover"]["title"])
    if len(cover) > 1 and deck["cover"].get("subtitle"):
        set_text(cover[1], deck["cover"]["subtitle"])
    for slide, page in zip([prs.slides[m["content"]], *copies], pages):
        slots = text_slots(slide)
        set_text(slots[0], page["title"])
        if len(slots) > 1:
            set_text(slots[1], page["points"])
    closing = text_slots(prs.slides[m["closing"]])
    set_text(closing[0], deck["closing"]["title"])
    move_slide(prs, m["closing"], len(prs.slides) - 1)
    prs.save(out)
    print(f"OK {out} slides={len(prs.slides)}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "inspect":
        inspect(sys.argv[2])
    elif cmd == "build":
        build(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(f"unknown command {cmd}")
```

## deck.json 示例

```json
{
  "slots": { "cover": 0, "content": 1, "closing": 2 },
  "cover": { "title": "2026 年度述职报告", "subtitle": "张三 · 平台研发部" },
  "pages": [
    { "title": "核心业绩", "points": ["交付 12 个项目", "成本下降 18%"] },
    { "title": "下阶段规划", "points": ["目标一", "目标二"] }
  ],
  "closing": { "title": "谢谢" }
}
```
