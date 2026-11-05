# 小红书场景路由矩阵 (Routing Matrix)

| 场景分类 | 用户意图 / 关键词 | 目标专精 Skill | 所属源码仓库 | 未安装时优雅降级 / 兜底策略 |
| :--- | :--- | :--- | :--- | :--- |
| **从零起号与人设** | 起号、定位、赛道选择、人设三件套、内容支柱、前20篇规划 | `space-xhs-positioning` | `creator-buddy/xhs-Skills` | Router 引导使用 3 步定位法（对标人群、差异化优势、商业变现闭环）直接输出人设方案 |
| **热点挖掘与对标** | 找热点、看最近爆款、竞品对标、热门选题、提取爆款共性 | `space-xhs-hotspot` | `creator-buddy/xhs-Skills` | Router 使用公开搜索引擎检索该领域近期高赞笔记，并提炼 3 个核心热点方向 |
| **爆款标题 15 式** | 起标题、改标题、优化标题、标题点击率低、多出几个标题 | `space-xhs-title` | `creator-buddy/xhs-Skills` | Router 直接调用内置《5大核心爆发力标题公式》输出 5 个高点击率候选标题 |
| **单篇产品/开源项目** | 推广工具、开源项目推广、产品种草、功能卖点打分、带截图做图 | `xhs-writer` | `xhs-writer-skill` | Router 运用 `稀缺性×实用性×可感知度` 卖点打分模型，提炼核心卖点并草拟卡片大纲 |
| **通用正文与体检** | 撰写笔记正文、改写文案、查违禁词、7种体裁笔记、发帖前体检 | `space-xhs-writer` | `creator-buddy/xhs-Skills` | Router 采用短段落、痛点引导与 `humanizer-zh` 拟人化口吻直接输出可复制正文 |
| **HTML 杂志级排版** | HTML排版、做卡片、高颜值图卡、3:4纯代码转图、62套模板 | `xhs-html` | `creator-buddy/xhs-Skills` | Router 生成自包含样式的单文件 3:4 HTML 页面，提供手机端自适应预览 |
| **封面与全套视觉图卡** | 做封面、小红书配图、艺术画风、科技感组图、信息图卡、出图 | `leo-imagine-router` | 视觉智能调度中枢 | **全权委托至 `leo-imagine-router`**：由其动态裁决画风（如 `mono-color`、`scenes-gathered`、`photo-abstract`、`xhs-html` 或通用生图），统一输出 3:4 竖屏图片至 `图片/发布版/`，严格遵循 7:3 中英文排版与至少 5 张图硬指标 |
| **账号八维体检** | 账号体检、卡点诊断、为什么没流量、主页装修诊断 | `space-xhs-account-audit` | `creator-buddy/xhs-Skills` | 针对博主主页介绍、封面一致性、近期笔记互动率进行八维打分并给出改进建议 |
| **六层漏斗数据复盘** | 笔记复盘、曝光低、点赞低、有点击没收藏、完播率低 | `space-xhs-note-analytics` | `creator-buddy/xhs-Skills` | 采用六层漏斗归因（曝光→CTR→阅读→互动→转粉→转化）定位卡点，反哺标题与正文 |
| **自动化上传与发布** | 自动发小红书、帮我上传、填好草稿、发到小红书 | `leo-lantern` | `lib/skills/leo-lantern` | 通过 CDP 原生上传图片、自动填充标题和 ProseMirror 富文本，经用户确认后一键发布 |
