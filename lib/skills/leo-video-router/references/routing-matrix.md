# 场景路由矩阵

Router 只决定交给谁，执行方式看各项目接入卡。

| 场景 | 触发词 | 项目 | 画面来源 | 音频类型 | 接入卡 |
|---|---|---|---|---|---|
| 给个主题，快速或批量出「旁白 + 素材混剪 + 字幕 + BGM」的竖屏信息流短视频 | 批量、快速出一条、信息流、混剪、矩阵号、给个主题就行、抖音/小红书/TikTok 竖屏 | MoneyPrinterTurbo | 素材库关键词匹配，可选生成模型 | 内生 | [接入卡](projects/MoneyPrinterTurbo.md) |
| 已有素材的加工：真人口播剪辑、长视频切短、播客转视频、多语字幕与配音、录屏演示、档案素材纪录片、预告片、主题讲解、数字人口播 | 剪辑我的素材、长视频切片、播客转视频、翻译配音、多语字幕、录屏演示、纪录片混剪、预告片、数字人口播 | OpenMontage | 素材优先，Python 工具 + 13 条 pipeline | 内生 | [接入卡](projects/OpenMontage.md) |
| 用 AI 生成的人物表演：UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员 + MG、旁白带货 | AI 人物出镜、UGC 口播、短剧、双人播客、街头采访、排行榜、讲解员、复刻这条社媒视频 | hypit | 生成优先，以词为锚的时间轴 | 内生 | [接入卡](projects/hypit.md) |
| 指定风格的代码短片（66 种风格，含「剪辑与纪实」「实证影像」），保存自己的风格 | 点名库里的风格（油画厚涂、浮世绘、卫星简报、产品拆解……）、有哪些风格、存成我的风格 | lemo-opuscar | 代码逐帧 | 内生（可外配） | [接入卡](projects/lemo-opuscar.md) |
| 不限风格的代码视频：先出三个方案加预览、按用户音乐卡点、绿幕人物 + 代码场景、Manim、只要提示词 | 用代码做视频、先给几个方案、按我的音乐卡点、绿幕人物、Manim、只要提示词 | xilo-opus-video | 代码逐帧 | 可选 | [接入卡](projects/xilo-opus-video.md) |
| 中文知识口播（15–60 秒）→ 风格讲解动画，可直接拖进剪映 | 把这段口播做成动画、手绘笔记/扁平流程图/复古报刊等 7 套风格、拖进剪映 | dashi-animationstyle | 代码逐帧 | **必须先有口播** | [接入卡](projects/dashi-animationstyle.md) |
| 具名艺术家笔法、名画穿越、YouTube 解说语法（Vox / 3b1b / Kurzgesagt / 白板 / 财经） | 梵高/莫奈等具名艺术家、名画穿越、艺术史、Vox/3b1b/Kurzgesagt/白板/财经解说 | huashu-art-motion | 代码 + 生成帧 | 可选 | [接入卡](projects/huashu-art-motion.md) |
| 用真实网页做产品宣传片（镜头卡、Ink Press 模板、导出剪映工程），或给已有视频配音效 | 产品宣传片、给我的网站/App 做片、Ink Press、给视频配音效 | video-shotcraft | 真实页面截图 + Remotion | 无旁白 | [接入卡](projects/video-shotcraft.md) |

## 重叠项目的区分规则

- 要 AI 生成人物表演 → hypit；加工已有素材 → OpenMontage。两者都能复刻参考视频：社媒真人表演类 → hypit，混剪 / 预告 / 讲解类 → OpenMontage。
- 「批量」「快速出一条」「信息流」「矩阵号」「给个主题就行」 → MoneyPrinterTurbo；要镜头设计和风格 → 代码视频类或 OpenMontage。
- 点名艺术家或要「穿越」 → huashu；风格在 lemo 目录里 → lemo。
- 已有或要生成口播的中文讲解 → dashi。
- 没指定风格、想先看几个方案、要绿幕合成或 Manim → xilo。
- 产品宣传片一律 → video-shotcraft。

## 歧义处理

命中两个以上项目时，给出最多 2 个候选和一句话区别，让用户选。

## 已移除

- `mg-styles-15`：只有 15 份提示词，不是 skill，固定 10 秒；风格被 lemo-opuscar 覆盖，自由创作被 xilo-opus-video 覆盖。
