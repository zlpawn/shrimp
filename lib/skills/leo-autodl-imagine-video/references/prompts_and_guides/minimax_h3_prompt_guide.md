# MiniMax-H3 六段式提示词与分镜/对白编写指南

本指南提炼自云端镜像内置的 MiniMax-H3 提示词规范（去除了四套模式间的重复段落，完整保留全部规则与四种模式差异）。

---

## 一、六段式标准结构

MiniMax-H3 规范提示词由以下 6 个核心段落组成（按顺序）：
1. subject_definitions：每行一条主体/参考内容的身份锁定定义句。
2. summary：一段英文，以方括号任务类型前缀开头（如 [reference generation]、[keyframe completion]、[text to video]）。
3. 
etention_analysis：每行一条参考内容或主体的一致性保留关系。
4. detailed_description：成片正文，含风格开场句与 [Shot N] 分镜描述（换行分隔）。
5. overall_soundscape：全片环境音与现场物理声。
6. 
on_diegetic_music：只有观众能听到的背景配乐（没有则写 N/A）。

---

## 二、四种生成模式的专属差异规则

### 1. 全参考模式 (ullReference — 多图/视频/音频参考生视频，如 U01/U04/U06/U24/U30)
- **任务类型 (summary 前缀)**：只能是 [reference generation]、[video editing]、[video continuation]、[audio reuse]、[audio reference]（多个用  +  连接），禁止写 [text to video]。
- **subject_definitions（身份锁定段）**：
  - 每一行写清三件事：标签是什么、来自哪张图/视频/音频、在成片里起什么作用及要跟随哪些可见特征（通常 5-8 项：年龄感、发型发色与盘法、五官与妆容、肤色、服装款式/颜色/面料、配饰、体态）。
  - 人物示例：<Subject 1> is the young woman in <Picture 1>, with long dark hair falling over one shoulder, a pale complexion, a blue knit cardigan over a white blouse, and a thin silver necklace.
  - 场景示例：<Subject 1> is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.
- **
etention_analysis**：
  - 可见内容枚举：ully_preserved / partially_preserved / ttribute_transfer / weak_reference；音频枚举：ully_copy / partially_copy / 
eference / weak_reference。
  - <Subject N> 写法：<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...（必须与正文实际分镜一一对应）。

### 2. 首尾帧插值模式 (keyframeFl2va — <Picture 1> 首帧 + <Picture 2> 尾帧，如 U02-V2)
- **任务类型 (summary 前缀)**：必须以 [keyframe completion] 开头，说明视频从 <Picture 1> 插值到 <Picture 2> 以及主体/光线/运镜的变化。
- **subject_definitions**：
  - 必须包含首尾帧锚点行：
    - <Picture 1> is the first frame of the target video, showing …
    - <Picture 2> is the last frame of the target video, showing …
  - 另写主体身份锁定行：<Subject 1> is … in <Picture 1> and <Picture 2>, ...
- **
etention_analysis**：
  - <Picture 1> ([Shot 1] first frame): fully_preserved - ...
  - <Picture 2> (final frame): fully_preserved - ...
  - <Subject 1> (appears in …): partially_preserved / fully_preserved - …
- **detailed_description 额外要求**：
  - [Shot 1] 必须写明从 <Picture 1> 起幅（	he shot begins from <Picture 1>）；最后一镜必须写明落幅在 <Picture 2>（	he shot ends on <Picture 2>）。

### 3. 单图首帧模式 (keyframeI2va — 仅 <Picture 1> 首帧，如 U02 基础版)
- **任务类型 (summary 前缀)**：必须以 [keyframe completion] 开头，说明视频从 <Picture 1> 首帧延续。
- **subject_definitions**：
  - 包含首帧锚点行：<Picture 1> is the first frame of the target video, showing …
  - 另写主体身份锁定行：<Subject 1> is … in <Picture 1>, ...
- **detailed_description 额外要求**：
  - [Shot 1] 必须写明从 <Picture 1> 起幅（	he shot begins from <Picture 1>），后续延续动作与运镜，不要引用不存在的 <Picture 2>。

### 4. 纯文生视频模式 (keyframeT2va — 无任何参考素材，如 U03)
- **任务类型 (summary 前缀)**：只能是 [text to video]，禁止出现 <Picture N>、<Video N>、<Audio N> 等参考标签。
- **subject_definitions**：
  - 把人物、生物、核心物件写成 <Subject N> 一行定义句（如 <Subject 1> is a young woman with long dark hair...），补齐前后一致的可拍摄外观设定。
- **
etention_analysis**：
  - 每个 <Subject N> 一行，写全片保持一致的特征：<Subject 1> (appears in [Shot 1], [Shot 2]): consistent - …。

---

## 三、素材图类型路由（有参考图时适用）

- **场景拼图（Grid Scene Composite）**：图是同一场景的不同视角/镜头（如四宫格环境拼图）。subject_definitions 按方位拆解板块：Upper-left / Upper-right / Lower-left / Lower-right，写清每格空间与光线；正文按板块映射到对应镜头。
- **角色设集（Character Model Sheet）**：图是同一主体的三视图、表情或特写拼图（如立绘设定集）。禁止按格子拆成多人或多场景，必须把全图融合成一条整体特征描述，并标注 multi-view character reference sheet；正文调用视角时写 
eferencing the profile/back view of <Subject N>。

---

## 四、通用核心规范（所有模式共用）

# 用户本意保全
- 改写只补格式与细节，不改用户已经决定的事。动笔前先从用户原文挑出硬约束：台词、标签、镜数、运镜/景别、风格、否定项、语气；写完后逐条核对都已落到六段里，缺一条就改到落位为止。
- 用户原文里的 <d>…</d> 台词逐字保留：不润色、不翻译、不删重复词、不拆句不并句，条数与用户写的一致。只允许按官方规则补句末 . ? ! 这类基本标点，去掉多余的波浪号、表情符号。
- 用户已写的 <Subject N> (Sx) 绑定、[Shot N] 序列、<scenetrans> / <cutoff>、[任务类型] 标签一律原样保留、位置不变；你只能在其前后补描述，不得改号、删除或替换成散文。
- 用户写了语气 / 音量 / 情绪（小声、生气、颤抖、喊、笑着说）时，写成 <d> 外、动词之后的 delivery 描述并保留 says 动词：says in a low whisper / says, raising his voice / says with a trembling tone / says with a soft laugh。用户明确写「喊 / 吼」可以用 shouts。不要把这些信息删掉，也不要用眼神、肩线代替用户写的声音表现。
- 用户写了运镜、景别、光线、风格词时必须落地，并映射到官方词表：Push In / Pull Out、Zoom In / Zoom Out、Pan Left / Pan Right、Truck Left / Truck Right、Tilt Up / Tilt Down、Pedestal Up / Pedestal Down、Arc Shot、Tracking Shot、Static Shot、POV、Shake Slightly / Shake Strongly、Roll Clockwise / Counterclockwise，幅度用 with small / large amplitude，速度用 at slow / fast speed。不得换成别的运镜；用户写了静止镜头就不要加运动；用户写了「水墨 / 赛博朋克 / 定格动画」等风格，风格开场句必须用它，不要改成默认的 cinematic realistic。用户没写的部分才由你补。
- 用户的「不要 / 禁止 / 别 / 无 / 不出现」是硬约束：不要配乐 → non_diegetic_music 写 N/A；不要切镜 → 只写 [Shot 1]；不要字幕 / 文字 → 不写画面可见文字；不要说话 → 不写 <d>；不要某个动作或元素 → 全片不得出现。
- 画面中可见的招牌、字幕、标签、屏幕文字用英文双引号把原文照抄进去（例如 a neon sign reading "营业中"），不翻译、不改写。
- 用户原文已带 [video editing] / [audio reuse] / [video continuation] 等任务类型标签时按用户的写，不要改回 reference generation；用户写了 <Picture N> 作首帧 / 尾帧时按用户的角色写，不要另派用途。
- subject_definitions 是身份锁定段：标签含义 + 参考角色 + 需要跟随的主要特征。官方短句（with long dark hair, a blue cardigan, and a thin silver necklace）只是句式，不是质量上限。
- 用户原文已经写了规范定义句（<Subject N> is the … in <Picture N>. 或中文「<Subject N> 是 <Picture N> 中的…」）时，必须保留原句身份名，禁止再套一层 is the young woman / a man in <Picture N>。只允许在原句逗号后补用户没写、但图中可见的特征；不要把「蓝衣女孩」改成 the young woman。JSON 数组值只写定义句正文，禁止再写 subject_definitions: 段名。
- 每一行写清三件事：这个标签是什么、来自哪张图/哪段视频/哪段音频、在成片里起什么作用、要跟随哪些可见特征。
- 人物/生物对照参考图写真实可见、能把该主体认出来的特征，图中有多少写多少，通常 5-8 项：年龄感、发型发色与盘法、五官与妆容（仅写图中可见）、肤色、服装款式/颜色/面料或纹样、配饰、体态与标志性姿态。图里没有的不要编。
- 场景/环境写空间结构、关键陈设与材质、主色、标志物、光线与天气，不要只写「雪景」「房间」。官方完整示例的粒度是：exposed brick wall, orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table。
- 服装、道具、风格若被单独跟踪，各自成行；仅用于定义人物的图不要单独立 <Picture N>。
- 多素材定义同一主体时合并成一句，并说明各素材分别提供外观、动作还是音色。
- 定义句保持一行一句。动作、运镜、对白、光影变化留给 detailed_description，不要在定义段写成小传或分镜。
- 人物定义句目标粒度（仍保持一行）：<Subject 1> is the young woman in <Picture 1>, with long dark hair falling over one shoulder, a pale complexion, a blue knit cardigan over a white blouse, and a thin silver necklace.
- 场景定义句目标粒度：<Subject 1> is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.

# 镜数与同框
- MiniMax H3 每镜需要 2.5–4.0 秒呼吸空间，才能稳住物理与身份；禁止 1 秒碎切，禁止为每个参考单独切一镜。
- 按时长卡镜头数（含 [Shot 1]）既是上限也是下限：该时长最多写这么多镜（防 1 秒碎切），同时总时长必须装得下用户已给出的镜数。
  · 4.0–6.0 秒：最多 1 或 2 镜
  · 7.0–10.0 秒：最多 2 或 3 镜
  · 11.0–15.0 秒：最多 3 到 5 镜
- 用户未给分镜时：先定时长再切镜。用户已给 N 镜时：先保完整镜序，再按「分镜数量与总时长联动」反推总时长。切点必须严格小于目标时长，不要写完分镜再补会越界的时间戳。
- 多主体 / 多参考在短片（尤其 4–6 秒）必须同框调度：用前景 / 中景 / 后景把角色、生物、载具、场景放进同一画面互动。禁止一人一镜、一参考一镜的孤立幻灯片。
- 一条连贯运镜（Tracking Shot、Pan、Push In）可以在同一镜里带出全部参考。
- 镜间用 Match on Action、Eyeline Match 或 Whip Pan 衔接；[Shot 1] 的动作要能触发下一镜的反应。
# 分镜数量与总时长联动
- 用户原文已给出明确分镜（[Shot N]、Shot N、镜头N、第N镜）时，改写必须严格保留这 N 个分镜的完整序列，从 [Shot 1] 写到 [Shot N]。禁止删镜、并镜、跳号，禁止把后镜剧情/对白硬塞进前镜。
- 分镜与对白完整性是硬约束，高于页面默认 5 秒，也高于“按时长卡镜头数”的上限表。不得为省事、省词或迁就短时长而裁切、少于用户分镜。
- 用户给了 4 镜加多段对白（Shot 1 到 Shot 4）时，必须完整覆盖对白时间线与核心剧情；绝不能吞掉 Shot 3 / Shot 4。
- 用户给出 N 个分镜时，先按镜数反推总时长，再写切点；禁止死守 5 秒。反推对照：
  · 1 镜 → 4.0–6.0 秒
  · 2 镜 → 5.0–6.0 秒（对白密可到 7.0–10.0 秒）
  · 3 镜 → 7.0–10.0 秒（对白密可到 11.0–12.0 秒）
  · 4 镜 → 必须 12.0–15.0 秒
  · 5 镜 → 必须 13.0–15.0 秒
- 错误：用户给了 4 镜，却把总时长写成 5 秒（5 秒最多 2 镜），再把 Shot 3/4 塞进 Shot 2，导致语法错误。
- 正确：用户给了 4 镜 → summary 与切点按 12–15 秒写，detailed_description 依次出现 [Shot 1] [Shot 2] [Shot 3] [Shot 4]。
- retention_analysis 的 appears in 必须与 detailed_description 实际写出的 [Shot N] 一致。
# 镜头衔接
- MiniMax H3 若每个镜头一切过去立刻出声音/台词，会产生机械剪辑感和声音突兀感，像广播剧配画。必须用视觉垫字、视线引导和视听交错拉开对白。
- 视觉垫字（Visual Buffer）：镜头切过去后，先写 0.3–0.5 秒微动作缓冲（转头、停顿、对视、换气、落步、推门前的停顿），再触发台词。禁止 [Shot N] 一开场就 <d>。
- 视线引导与因果衔接（Eyeline & Action Match）：上一镜的动作或视线落点，直接作为下一镜的起幅焦点。[Shot 1] 的动作必须能触发下一镜的反应。
- 物理视听交错（J-Cut / L-Cut）：台词出来前，先让画面中的环境物理声（脚步、开门、风雪、布料）作铺垫；overall_soundscape 要写出这些铺垫声，不要只在对白当下才出现声音。
- 正确：They pause under the eaves; winter light hits their faces. After a brief beat, <Subject 3> (S2) says, <d>[Chinese] 是啊，但愿群主起来了</d>.
- 错误：At 00:04.000, <Subject 3> (S2) says, <d>...（切镜立刻对白）
- 同一句台词跨切（ref-en 5.x / base-en 4.4）：在两段衔接处都写 <scenetrans>，并写明 the line continues seamlessly across the cut / carries over from the previous shot；台词被视频结尾截断时在句尾写 <cutoff>。用户原文里已有的 <scenetrans> / <cutoff> 必须原样保留在同一位置，不得删掉或改成散文。
- 有人发声时必须同时写出：主体标签 + 说话人编号 + 发声句式 + 对白语言和文字。
# 对白发声
- 画面内角色互相说话、问候、问答时，默认开口对白，不要改成画外音或闭口思维配音。正确：<Subject 1> (S1) says, <d>[Chinese] 师姐，我们就快要到了。</d>
- 禁止把用户没写「画外音 / 旁白 / 解说 / 内心独白 / 思维配音 / off-screen」的对白，一律写成 says in an off-screen voiceover, while their lips remain completely closed。
- 只有以下情况才写画外音：用户原文写了画外音/旁白/解说/narrator/off-screen；说话人当时不在画面内；用户点了男性/女性画外音；或台词本身是说书/旁白（如「故事就从这里开始」「欲知后事如何」）。
- 角色在画外说话：保持 <Subject N> (Sx)，并标注 off-screen。正确：<Subject 1> (S1) says off-screen, <d>[Chinese] 师姐，我们就快要到了。</d>
- 对不上已定义主体的旁白：a male narrator (S4) says in an off-screen voiceover, <d>[Chinese] 故事就从这里开始，欲知后事如何，请听下回讲解。</d>
- 仅当用户明确要求内心独白 / 思维配音 / 闭口配音时，才用：<Subject N> (Sx) says in an off-screen voiceover, while their lips remain completely closed, <d>[Language] 台词。</d>
- 语气、音量、情绪写在 <d> 外、动词之后（says in a low whisper / says, raising her voice / says with a trembling tone），保留用户写的情绪，不要删。用户明确写「喊 / 吼」时可用 shouts；只有闭口思维配音模式才禁止 shouts / yells / screams 等张嘴动词。不要给开口对白加 lips remain completely closed。
- (Sx) 按成片里实际发声顺序从 (S1) 起编，同一发声源全程复用；不要在 retention_analysis 里写 (Sx)。
# 多人齐声
- 用户原文或画面明显是多人同时想同一句、齐声、一起喊、合唱同一句时，必须用复合说话人编号 (S1,S2)，不要并排写 (S1) (S2)。
- 正确：<Subject 1> and <Subject 2> (S1,S2) say, <d>[Chinese] 师姐我们一起去吧！</d>
- 中文叙述同样结构：<Subject 1> 和 <Subject 2> (S1,S2) 齐声说出，<d>[Chinese] 师姐我们一起去吧！</d>
- 错误：<Subject 1> (S1) <Subject 2> (S2) 一起说 <d>[Chinese] …</d>（这会被读成两个人先后开口）
- 齐声同样用 say, <d>…</d>；用户写了「一起喊」时可用 shout together。
- (S1,S2) 里的编号必须是各人第一次单独发声时已经分好的号，这次只复用，不新分配；同一句只写一个 <d>。
- 先后对白仍各自写 <Subject N> (Sx) says, <d>…</d>。
- 对不上已定义主体的旁白，用稳定音色描述 + (Sx)，例如 a male narrator (S4) says in an off-screen voiceover, <d>[Chinese] 故事就从这里开始。</d>
- 只有直接复用的 BGM/完整音轨里的唱词才用 <Audio N> 当声源，不要再编一个 (Sx)。
- 生成类任务按 350-500 英文词的信息量来写（中文输出时保持同等细节，不要因为换语言而变短）。对白密集时优先把台词时间线写完整，宁可按分镜反推拉长总时长，也不要为凑 5 秒或省事删对白、删分镜；自然语速大约每秒 2.5 个英文词，不要把时长塞满对白。
- overall_soundscape 只写全片环境音与现场物理声，不要写观众听到的配乐。
- non_diegetic_music 只写观众听到、角色听不到的配乐；有配乐时写乐器、速度、动态，不要只写「轻快」或「悲伤」。没有配乐写 N/A。
- 完整台词只写在 detailed_description 的 <d> 里，不要在声音两段重复整句台词。
