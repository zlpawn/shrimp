# video-shotcraft

仓库：https://github.com/Vincentwei1021/video-shotcraft

## 适合

- 用前端项目或网页的真实截图做电影感产品宣传片。
- 三种模式：Ink Press 模板、自主自由创作、共同创作。
- 单镜头动效；导出剪映工程。
- 给已有视频或镜头找、加、对齐音效。

## 不适合

- 需要旁白的口播视频（作者另有 video-talkcraft，未纳入）。

## 安装

- `npx skills add Vincentwei1021/video-shotcraft -g -y`

## 交接

- 从 `python3 <本 skill 目录>/scripts/registry.py locate video-shotcraft`（`<本 skill 目录>` 即含 SKILL.md 的 leo-video-router 目录；Windows 上用 `python`）输出的 `entry_dir` 读其 SKILL.md：先判断任务范围；未选模式时先做只读产品检查，再让用户选三种模式之一。

## 音频

- 无旁白，BGM 和音效由它处理；不需要 omnivoice。

## 注意

- Gallery 地址 `https://vincentwei1021.github.io/video-shotcraft/`，用户可在里面挑镜头卡。
