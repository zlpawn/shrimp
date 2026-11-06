# 模板：固定机位多人对白短剧（文戏）

**适用**：2–4 个人物在同一场景里对话，镜头固定或基本不动，多个镜头要保持同一机位和站位。比如职场小剧场、对比反转短片。

**验证情况**：《食堂让座·高下立判》（2026-11-06），9:16，两个镜头共 15.3 秒，3 个人物，1-pass 工作流。人物一致性、站位、台词逐字和普通话发音都达标。口型归属只靠抽帧看过，没有逐帧核对。

六段式的完整规则见 [../prompts_and_guides/minimax_h3_prompt_guide.md](../prompts_and_guides/minimax_h3_prompt_guide.md)，这里只写这类片子额外要注意的地方。

---

## 流程

1. **先出布局定妆图**：用生图把机位、所有人的位置和朝向、关键道具写进一张图，一次出 3–4 张，挑出站位完全对的那张。生图模板不接收参考图（`--ref-images` 不生效），所以要靠提示词把空间关系写清楚。
2. **所有镜头都只用这张定妆图作参考**（`reference_images` 只放它）。不要再另给人物图和场景图，否则模型会自己决定站位，各镜头的机位也会对不上。
3. **定妆图里的状态就是每个镜头的第一帧**。镜头开场时人物姿态要是和定妆图不同（比如定妆图里坐着、镜头要求站着开场），模型会先拍出这个变化过程。

## 提示词要点

- **subject_definitions** 用定妆图里的位置区分人物：`<Subject 2> is the seated young woman on the right of <Picture 1>, ...`。场景单独一行，写明 `with the same camera position and framing`。
- **detailed_description** 开头写一句 `No subtitles, no captions and no on-screen text appear at any time.`，否则模型可能在画面里写字。
- **镜头锁死**：`Static Shot with the same camera position and framing as <Picture 1>, with no zoom, no push in and no camera shake for the whole shot.`
- **说话人编号每次生成都从 (S1) 开始**：每个镜头是单独生成的，所以镜头二里第一个开口的人也是 (S1)，不用延续镜头一的编号。
- **每句台词**都在 says 后面加 `speaks in clear standard Mandarin`，并且先给一拍缓冲：`after a brief beat <Subject 1> (S1) says politely, speaks in clear standard Mandarin, <d>[Chinese] ……</d>`。
- **不说话的人要写明闭嘴**：`Only <Subject 3> moves his lips for this line.`，同时给其他在场人物写上 `with his lips closed`。否则台词可能被安到别人嘴上。
- **走位**：写清起点、终点和步态，并排除跳变：`walks forward ... at a steady, unhurried pace with continuous natural steps ... There is no jump, no sudden acceleration and no zoom.`
- **镜头结尾**：让人物停住并保持姿态到结尾（`holds that pose until the end`），后期加片尾效果时更好接。

## 时长

工作流把秒数换算成 24fps 下的 17n+5 帧，并且**向上取整**，所以实际时长可能比给的长，排时间轴要用实际时长：

| `--duration` | 帧数 | 实际时长 |
|---|---|---|
| 8.0 | 192 | 8.00 秒 |
| 7.0 | 175 | 7.29 秒 |

## 参数（这次用过，没做对比实验）

| 项 | 值 |
|---|---|
| 定妆图 | `--image --width 736 --height 1280 --steps 12` |
| 视频 | `--aspect-ratio 9:16`，0.9MP（实际 736×1280），`--steps 16`，`--patch "174.inputs.reuse_threshold=0.15"` |

---

## 示例

### 布局定妆图

```text
Vertical photo from a static eye-level camera looking straight down the central aisle of a bright modern corporate staff cafeteria at lunchtime, tall windows on the right, a light wood pillar on the left, light wood tables with white chairs in rows on both sides of the aisle. In the middle ground two diners sit BACK TO BACK across the aisle, both seen in profile and facing away from each other: on the left a handsome young East Asian man with crisp short black hair in a clean blue button-up shirt sits facing left toward his own table, eating noodles, his back to the aisle; on the right a plump young East Asian woman with thin-framed glasses, shoulder-length dark hair and a chunky oatmeal cable-knit sweater sits facing right toward her own table, her back to the aisle. The backs of their two white chairs touch in the exact center of the aisle and completely block it. Directly behind the touching chair backs, a slim young East Asian man with short neat black hair, a light-colored button-up shirt and a company ID badge on a lanyard stands in the aisle facing the camera, holding a cafeteria tray with a steaming bowl of soup and rice dishes, unable to pass. Full bodies visible, photorealistic, natural soft daylight. No text, no watermark.
```

### 镜头（7 秒：一人让路说一句，另一人走到近景）

```text
subject_definitions:
<Subject 1> is the standing young man in the center of <Picture 1>, with short neat black hair, a light-colored button-up shirt, a company ID badge on a lanyard and dark trousers, holding a cafeteria tray with a steaming bowl of soup and rice dishes.
<Subject 2> is the seated young woman on the right of <Picture 1>, with a plump build, thin-framed glasses, shoulder-length dark hair and a chunky oatmeal cable-knit sweater.
<Subject 3> is the young man on the left of <Picture 1>, with crisp short black hair and a clean blue button-up shirt.
<Subject 4> is the staff cafeteria layout in <Picture 1>, with the same camera position and framing, tall windows on the right, a light wood pillar on the left, light wood tables and white chairs.

summary:
[reference generation] A 7-second single static shot with the same camera setup as <Picture 1>: the young man on the left has already stood up and tucked his chair under his table, opening the aisle; he stays standing, gestures for the man with the hot tray to pass and says one short line, then the man walks through the opened gap toward the camera with a grateful smile and without speaking.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - face, hair, light shirt, ID badge and tray.
<Subject 2> (appears in [Shot 1]): fully_preserved - face, glasses, sweater, still seated facing right with her back to the aisle.
<Subject 3> (appears in [Shot 1]): partially_preserved - same face, hair and blue shirt, but now standing beside his table instead of sitting.
<Subject 4> (appears in [Shot 1]): partially_preserved - same camera position, framing, windows on the right and pillar on the left; the left chair is now tucked under its table.

detailed_description:
Photorealistic, naturalistic workplace drama with soft bright daylight and deep focus, continuing the exact camera setup of <Picture 1>. No subtitles, no captions and no on-screen text appear at any time.

[Shot 1] Static Shot with the same camera position and framing as <Picture 1>, with no zoom, no push in, no pull out and no camera shake for the whole shot. From the first frame, <Subject 3> is already standing upright beside his table on the left, facing the aisle, and his white chair is already pushed neatly under his table, so the left half of the aisle is open. He holds one hand out toward the gap in a polite gesture of invitation, with a warm gentle smile. On the right <Subject 2> remains seated facing right toward her table with her back to the aisle, eating, without looking up; her chair stays where it was. <Subject 1> stands in the aisle behind them, holding the steaming tray with both hands. After a brief beat, <Subject 3> (S1) says warmly, speaks in clear standard Mandarin, <d>[Chinese] 过吧，小心烫。</d> Only <Subject 3> moves his lips for this line. Subject 1 lips firmly closed, smiling gratefully, no speaking. Then <Subject 1> gives a small grateful nod and walks forward through the open gap at a steady, unhurried pace with continuous natural steps, keeping the tray level, passing <Subject 3> toward the camera and looking straight ahead with his lips closed. <Subject 3> stays standing beside his table for the entire shot, keeps facing the aisle and watches <Subject 1> pass with a slight nod; he does not turn away, does not sit down and does not walk off. <Subject 1> stops in the foreground center in a medium close-up, still smiling with his lips closed, and holds that pose until the end. There is no jump, no sudden acceleration and no zoom.

overall_soundscape:
The same busy staff cafeteria ambience with low distant chatter and the clink of chopsticks and trays, with a brief pause before the line and steady footsteps on the floor approaching the camera after it.

non_diegetic_music:
N/A
```

这个镜头的第一帧仍是定妆图里的坐姿，模型先拍了 Subject 3 起身，再接后面的动作，和 summary 写的“已经站好”不同（见上面“流程”第 3 条）。
